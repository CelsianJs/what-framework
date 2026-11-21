// What Framework - Islands Architecture
// Each interactive piece of the page is an "island" — a self-contained
// component that hydrates independently. The rest is static HTML.
//
// Features:
//   - Multiple hydration modes (load, idle, visible, action, media, static)
//   - Shared state across islands
//   - Priority-based hydration queue
//   - Progressive enhancement
//
// Modes:
//   'static'  - No JS shipped. Pure HTML. (nav, footer, etc.)
//   'idle'    - Hydrate when browser is idle (requestIdleCallback)
//   'visible' - Hydrate when scrolled into view (IntersectionObserver)
//   'load'    - Hydrate immediately on page load
//   'media'   - Hydrate when media query matches (e.g., mobile-only)
//   'action'  - Hydrate on first user interaction (click, focus, hover)

import { h, mount, hydrate, signal, batch } from 'what-core';
import { getServerContext, _currentOwnerPath, __readHydrationData, isVNode } from 'what-core/internal';
import { serializeState } from './serialize.js';

const islandRegistry = new Map();
const hydratedIslands = new Set();
const hydrationQueue = [];
let isProcessingQueue = false;

// --- Shared Island State ---
// Browser stores intentionally persist across islands and client navigations.
// Server stores belong to the active render context so one request can never
// observe another request's state. Which one a call gets is decided by the
// render scope, never by whether a `document` exists: under a DOM shim (jsdom,
// happy-dom) a server render sees one, and deciding by it put every request's
// stores in the one process-global browser map. A store obtained outside a
// render (a module-scope declaration) is a handle that resolves on every
// access: to the current request's store during a render, to the browser's
// outside one.

const browserStores = new Map();
const serverStoreDefinitions = new Map();

function cloneInitialState(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall through for values structuredClone cannot represent. Island
      // state is expected to be serializable, but preserving a shallow copy is
      // a safer compatibility fallback than sharing the original object.
    }
  }
  if (Array.isArray(value)) return value.map(cloneInitialState);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneInitialState(item)])
    );
  }
  return value;
}

function createConcreteStore(storeMap, name, initialState) {
  if (storeMap.has(name)) return storeMap.get(name);

  const store = {};
  const signals = {};

  // Create signals for each key in initial state
  for (const [key, value] of Object.entries(cloneInitialState(initialState))) {
    signals[key] = signal(value);
    Object.defineProperty(store, key, {
      get: () => signals[key](),
      set: (val) => signals[key].set(val),
      enumerable: true,
    });
  }

  // Methods to interact with store
  store._signals = signals;
  store._subscribe = (key, fn) => {
    if (signals[key]) {
      return signals[key].subscribe(fn);
    }
  };
  store._batch = (fn) => batch(fn);
  store._getSnapshot = () => {
    const snapshot = {};
    for (const [key, sig] of Object.entries(signals)) {
      snapshot[key] = sig.peek();
    }
    return snapshot;
  };
  store._hydrate = (data) => {
    batch(() => {
      for (const [key, value] of Object.entries(data)) {
        if (signals[key]) {
          signals[key].set(value);
        }
      }
    });
  };

  storeMap.set(name, store);
  return store;
}

function activeServerStoreMap(context) {
  const ctx = context || getServerContext();
  return ctx && ctx.islandStores instanceof Map ? ctx.islandStores : null;
}

// The map a store access resolves against right now: the render's during a
// server render, the browser's on a page, none on a server outside a render.
function currentStoreMap(context) {
  const storeMap = activeServerStoreMap(context);
  if (storeMap) return storeMap;
  return typeof document === 'undefined' || getServerContext() ? null : browserStores;
}

function storeHandle(name, initialState) {
  if (serverStoreDefinitions.has(name)) {
    return serverStoreDefinitions.get(name).handle;
  }

  const definition = {
    initialState: cloneInitialState(initialState),
    handle: null,
  };

  const resolve = () => {
    const storeMap = currentStoreMap();
    if (!storeMap) {
      // ERROR_CODES.ISLAND_STORE_OUTSIDE_RENDER
      throw Object.assign(
        new Error(
          `[what-server] Island store "${name}" was accessed outside an active server render. ` +
          'Read or write module-scoped island stores from a component rendered by renderDocument/renderPage.'
        ),
        { code: 'ERR_ISLAND_STORE_OUTSIDE_RENDER' },
      );
    }
    return createConcreteStore(storeMap, name, definition.initialState);
  };

  definition.handle = /** @type {any} */ (new Proxy({}, {
    get(_target, property) {
      return Reflect.get(resolve(), property);
    },
    set(_target, property, value) {
      return Reflect.set(resolve(), property, value);
    },
    has(_target, property) {
      return Reflect.has(resolve(), property);
    },
    ownKeys() {
      return Reflect.ownKeys(resolve());
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), property);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  }));

  serverStoreDefinitions.set(name, definition);
  return definition.handle;
}

export function createIslandStore(name, initialState) {
  const storeMap = activeServerStoreMap();
  if (storeMap) {
    const definition = serverStoreDefinitions.get(name);
    return createConcreteStore(storeMap, name, definition?.initialState ?? initialState);
  }
  return storeHandle(name, initialState);
}

// Get or create a shared store
export function useIslandStore(name, fallbackInitial = {}) {
  return createIslandStore(name, fallbackInitial);
}

// Serialize all shared stores for SSR.
// Uses serializeState (not bare JSON.stringify) so user-controlled store values
// containing "</script>" cannot break out of the <script> tag this is embedded
// in. (AUDIT-2026-06-06 H3)
export function serializeIslandStores() {
  return serializeState(getIslandStoresSnapshot());
}

// Raw (unserialized) snapshot of all shared island stores, so renderDocument can
// merge it into the single consolidated #__what_data payload (one serialize pass).
export function getIslandStoresSnapshot(context) {
  const storeMap = currentStoreMap(context);
  const data = {};
  for (const [name, store] of storeMap || []) {
    data[name] = store._getSnapshot();
  }
  return data;
}

// Hydrate shared stores from SSR data
export function hydrateIslandStores(serialized) {
  try {
    const data = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    for (const [name, storeData] of Object.entries(data)) {
      const store = useIslandStore(name, storeData);
      store._hydrate(storeData);
    }
  } catch (e) {
    console.warn('[what] Failed to hydrate island stores:', e);
  }
}

// --- Register an island component ---

export function island(name, loader, opts = {}) {
  islandRegistry.set(name, {
    loader,  // () => import('./MyComponent.js')
    mode: opts.mode || 'idle',
    media: opts.media || null,
    priority: opts.priority || 0, // Higher = hydrate first
    stores: opts.stores || [],    // Shared stores this island uses
  });
}

// --- Island props ---
// Props cross to the client as JSON, and a vnode carries no brand through
// JSON (what-core's isVNode), so an element passed as a prop
// (`props: { icon: h('svg', ...) }`) would arrive as a plain object and render
// as text. The server records where it wrote one: data-island-vnodes lists the
// paths of the props that were vnodes, and the client turns exactly those
// back into vnodes with h(). Nothing is revived by its shape, so an object a
// prop got from data, whatever it looks like, stays data. A component vnode
// has no JSON form and is left out, as a function prop is.

function encodeIslandValue(value, path, vnodes) {
  if (Array.isArray(value)) return value.map((item, i) => encodeIslandValue(item, [...path, i], vnodes));
  if (isVNode(value)) {
    if (typeof value.tag !== 'string') return undefined;
    vnodes.push(path);
    return {
      tag: value.tag,
      props: encodeIslandValue(value.props || {}, [...path, 'props'], vnodes),
      children: encodeIslandValue(value.children || [], [...path, 'children'], vnodes),
    };
  }
  if (value === null || typeof value !== 'object' || typeof value.toJSON === 'function') return value;
  const out = {};
  for (const key of Object.keys(value)) out[key] = encodeIslandValue(value[key], [...path, key], vnodes);
  return out;
}

/** Island props as JSON, and the paths in it that the client revives as vnodes. */
function serializeIslandProps(props) {
  const vnodes = [];
  const json = JSON.stringify(encodeIslandValue(props, [], vnodes));
  return { json, vnodes };
}

/**
 * The props an island was rendered with: `json` parsed, and the value at each
 * path in `vnodePaths` (deepest first) made a vnode again. A path that does
 * not lead to an element description is left as it is.
 */
function reviveIslandProps(json, vnodePaths) {
  const props = JSON.parse(json || '{}');
  const paths = vnodePaths ? JSON.parse(vnodePaths) : [];
  if (!Array.isArray(paths)) return props;
  for (let i = paths.length - 1; i >= 0; i--) {
    const path = paths[i];
    if (!Array.isArray(path) || path.length === 0) continue;
    let holder = props;
    for (let j = 0; j < path.length - 1 && holder != null; j++) holder = holder[path[j]];
    const key = path[path.length - 1];
    if (holder == null || typeof holder !== 'object' || !Object.hasOwn(holder, key)) continue;
    const element = holder[key];
    if (element === null || typeof element !== 'object' || typeof element.tag !== 'string') continue;
    const children = Array.isArray(element.children) ? element.children : [];
    holder[key] = h(element.tag, element.props && typeof element.props === 'object' ? element.props : null, ...children);
  }
  return props;
}

// --- Island wrapper for SSR ---
// Renders the static HTML with a marker the client can find. Rendered as a
// component, it also writes its own owner path as data-what-owner: the island
// component it wraps is its first child there, and the client, hydrating that
// component into this element, numbers it from the same path, so the island's
// keyless resources adopt their server values (what-core hydration-data.js).

export function Island({ name, props = {}, children, mode, priority, stores }) {
  const entry = islandRegistry.get(name);
  const resolvedMode = mode || entry?.mode || 'idle';
  const resolvedPriority = priority ?? entry?.priority ?? 0;
  const resolvedStores = stores || entry?.stores || [];
  const ownerPath = getServerContext() ? _currentOwnerPath() : undefined;

  // Server: render as a div with data attributes for hydration
  const { json, vnodes } = serializeIslandProps(props);
  /** @type {Record<string, any>} */
  const markerProps = {
    'data-island': name,
    'data-island-mode': resolvedMode,
    'data-island-props': json,
    'data-island-priority': resolvedPriority,
    'data-island-stores': JSON.stringify(resolvedStores),
  };
  if (vnodes.length > 0) markerProps['data-island-vnodes'] = JSON.stringify(vnodes);
  if (ownerPath !== undefined) markerProps['data-what-owner'] = ownerPath;
  return h('div', markerProps, children);
}

// --- Priority Hydration Queue ---

function enqueueHydration(task) {
  // Insert in priority order (higher priority first)
  let inserted = false;
  for (let i = 0; i < hydrationQueue.length; i++) {
    if (task.priority > hydrationQueue[i].priority) {
      hydrationQueue.splice(i, 0, task);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    hydrationQueue.push(task);
  }

  processQueue();
}

function processQueue() {
  if (isProcessingQueue || hydrationQueue.length === 0) return;
  isProcessingQueue = true;

  // Process one task at a time to avoid blocking
  const task = hydrationQueue.shift();

  Promise.resolve(task.hydrate())
    .catch(e => console.error('[what] Island hydration failed:', task.name, e))
    .finally(() => {
      isProcessingQueue = false;
      // Continue processing after a microtask
      queueMicrotask(processQueue);
    });
}

// Boost priority for an island (e.g., on user interaction)
export function boostIslandPriority(name, newPriority = 100) {
  for (const task of hydrationQueue) {
    if (task.name === name) {
      task.priority = newPriority;
      // Re-sort queue
      hydrationQueue.sort((a, b) => b.priority - a.priority);
      break;
    }
  }
}

// --- Client-side hydration ---

export function hydrateIslands() {
  // First, hydrate any shared stores from the page's hydration data (the
  // #__what_data payload, plus any streamed data elements).
  const payload = __readHydrationData();
  if (payload && payload.islandStores) hydrateIslandStores(payload.islandStores);

  const islands = document.querySelectorAll('[data-island]');

  for (const el of /** @type {NodeListOf<HTMLElement>} */ (islands)) {
    // Compiler-emitted islands (`<Counter client:idle />`) carry a direct
    // component reference and schedule their own hydration, so they are not in
    // the registry and must not be claimed here.
    if (el.dataset.islandSelf) continue;

    const name = el.dataset.island;
    const mode = el.dataset.islandMode || 'idle';
    const props = reviveIslandProps(el.dataset.islandProps, el.dataset.islandVnodes);
    const priority = parseInt(el.dataset.islandPriority || '0', 10);
    const stores = JSON.parse(el.dataset.islandStores || '[]');
    const entry = islandRegistry.get(name);

    if (!entry) {
      console.warn(`[what] Island "${name}" not registered`);
      continue;
    }

    // Skip if already hydrated
    if (hydratedIslands.has(el)) continue;

    scheduleHydration(el, entry, props, mode, priority, name, stores);
  }
}

function scheduleHydration(el, entry, props, mode, priority, name, stores) {
  const hydrateIsland = async () => {
    if (hydratedIslands.has(el)) return;
    hydratedIslands.add(el);

    const mod = await entry.loader();
    const Component = mod.default || mod;

    // Inject shared stores into props
    const storeProps = {};
    for (const storeName of stores) {
      storeProps[storeName] = useIslandStore(storeName);
    }

    // Use hydrate() to reuse server-rendered DOM instead of destroying/recreating.
    // As a component vnode, so it runs in a component context (its hooks work)
    // and is numbered from the island's owner path.
    const vnode = h(Component, { ...props, ...storeProps });
    if (el.childNodes.length > 0) {
      hydrate(vnode, el);
    } else {
      mount(vnode, el);
    }

    // Clean up data attributes
    el.removeAttribute('data-island');
    el.removeAttribute('data-island-mode');
    el.removeAttribute('data-island-props');
    el.removeAttribute('data-island-vnodes');
    el.removeAttribute('data-island-priority');
    el.removeAttribute('data-island-stores');
    el.removeAttribute('data-what-owner');

    // Dispatch event for analytics/debugging
    el.dispatchEvent(new CustomEvent('island:hydrated', {
      bubbles: true,
      detail: { name, mode },
    }));
  };

  switch (mode) {
    case 'load':
      // Immediate hydration via queue (respects priority)
      enqueueHydration({ name, priority: priority + 1000, hydrate: hydrateIsland });
      break;

    case 'idle':
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
          enqueueHydration({ name, priority, hydrate: hydrateIsland });
        });
      } else {
        setTimeout(() => {
          enqueueHydration({ name, priority, hydrate: hydrateIsland });
        }, 200);
      }
      break;

    case 'visible': {
      const observer = new IntersectionObserver((entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            obs.disconnect();
            enqueueHydration({ name, priority, hydrate: hydrateIsland });
            break;
          }
        }
      }, { rootMargin: '200px' });
      observer.observe(el);
      break;
    }

    case 'media': {
      const mq = window.matchMedia(entry.media || '(max-width: 768px)');
      if (mq.matches) {
        enqueueHydration({ name, priority, hydrate: hydrateIsland });
      } else {
        mq.addEventListener('change', (e) => {
          if (e.matches) {
            enqueueHydration({ name, priority, hydrate: hydrateIsland });
          }
        }, { once: true });
      }
      break;
    }

    case 'action': {
      const events = ['click', 'focus', 'mouseover', 'touchstart'];
      const handler = () => {
        events.forEach(e => el.removeEventListener(e, handler));
        // Boost priority since user interacted
        enqueueHydration({ name, priority: priority + 500, hydrate: hydrateIsland });
      };
      events.forEach(e => el.addEventListener(e, handler, { once: true, passive: true }));
      break;
    }

    case 'static':
      // Never hydrate
      break;

    default:
      enqueueHydration({ name, priority, hydrate: hydrateIsland });
  }
}

// --- Auto-discover islands from data attributes ---
// Call this once on the client to set up all islands.

export function autoIslands(registry) {
  for (const [name, config] of Object.entries(registry)) {
    island(name, config.loader || config, {
      mode: config.mode || 'idle',
      media: config.media,
      priority: config.priority || 0,
      stores: config.stores || [],
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hydrateIslands);
    } else {
      hydrateIslands();
    }
  }
}

// --- Progressive Enhancement Helpers ---

// Mark an element as progressively enhanced
export function enhance(selector, handler) {
  if (typeof document === 'undefined') return;

  const elements = document.querySelectorAll(selector);
  for (const el of elements) {
    if (el.dataset.enhanced) continue;
    el.dataset.enhanced = 'true';
    handler(el);
  }
}

/**
 * Recover the double-submit CSRF token for a form.
 *
 * The meta tag alone is not enough. A cached page (mode 'static' or 'hybrid') is
 * shared between visitors, so the adapter deliberately does NOT embed a
 * per-visitor token in it; the token lives only in the cookie. A form inside
 * such a page therefore has no meta tag to read, and blocking on that alone
 * refused perfectly valid submissions. `<Form>` also emits the token as a hidden
 * field, which is the same value, so all three sources are checked.
 */
function readFormCsrfToken(form) {
  const meta = document.querySelector('meta[name="csrf-token"]')
    || document.querySelector('meta[name="what-csrf-token"]');
  if (meta) return meta.getAttribute('content');

  const field = form.querySelector('input[name="what-csrf-token"], input[name="_csrf"]');
  if (field && field.value) return field.value;

  const cookie = document.cookie.match(/(?:^|;\s*)what-csrf=([^;]+)/);
  return cookie ? decodeURIComponent(cookie[1]) : null;
}

/**
 * Serialize a form the way the browser would, so an enhanced submit and a plain
 * one are indistinguishable to the server.
 *
 * Two details that look pedantic and are not:
 *   - newlines in every text entry normalize to CRLF. The urlencoded and
 *     multipart serializers both do this per spec; URLSearchParams does not, so
 *     a <textarea> round-tripped different bytes with JS on than with JS off.
 *   - a File under a non-multipart encoding contributes only its NAME, which is
 *     what a native submit sends. Sending "[object File]" would be worse than
 *     useless, and silently sending nothing hides a real mistake.
 */
function formEntries(form, submitter, multipart) {
  const data = new FormData(form);

  // FormData(form) never includes the submit button, so a multi-button form
  // could not tell the server which button was pressed. Native submits include
  // the submitter's name/value.
  if (submitter && submitter.name) {
    data.append(submitter.name, submitter.value ?? '');
  }

  if (multipart) return data;

  const params = new URLSearchParams();
  /** @type {string | null} */
  let droppedFile = null;
  for (const [key, value] of data) {
    if (typeof value === 'string') {
      params.append(key, value.replace(/\r\n|\r|\n/g, '\r\n'));
    } else {
      droppedFile = droppedFile || key;
      params.append(key, value.name ?? '');
    }
  }

  if (droppedFile && typeof console !== 'undefined') {
    console.warn(
      `[what] Form field "${droppedFile}" holds a file, but the form is not ` +
      'enctype="multipart/form-data", so only the file NAME is sent. This is what ' +
      'a plain HTML submit does too. Add enctype="multipart/form-data" to upload ' +
      'the bytes.'
    );
  }
  return params;
}

/**
 * Form enhancement: submit via fetch instead of a full page load.
 *
 * The encoding is not a detail. `/__what_action` parses
 * application/x-www-form-urlencoded or JSON, never multipart, so an enhanced
 * submit of a default form has to use the same encoding as the plain HTML submit
 * it replaces. Posting a FormData object unconditionally produced a multipart
 * body the endpoint could not parse: the action id went missing and every
 * enhanced `<Form>` failed with 400 while the no-JS path kept working.
 *
 * The encoding now follows the form's own `enctype`, exactly as the browser
 * would, so a form that declares multipart still uploads its files.
 *
 * On success the action endpoint answers 303 to the form's `_redirect` target,
 * which fetch follows. The page is then navigated there so the enhanced path
 * lands where the unenhanced one would. Cancel the `form:response` event to keep
 * the page put and handle the response yourself.
 */
export function enhanceForms(selector = 'form[data-enhance]') {
  enhance(selector, (form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      try {
        // getAttribute, never the properties. HTMLFormElement is
        // [LegacyOverrideBuiltIns]: a field named "method" or "action" SHADOWS
        // form.method / form.action with the input element itself. Reading
        // `form.method.toUpperCase()` then threw a TypeError after
        // preventDefault() had already run, so the submit produced no fetch, no
        // form:error, and no native fallback. It just did nothing.
        const submitter = event.submitter || null;
        const attr = (name) => (submitter && submitter.getAttribute(`form${name}`))
          || form.getAttribute(name);

        const method = (attr('method') || 'get').toUpperCase();
        const action = new URL(attr('action') || location.href, location.href);
        const enctype = (attr('enctype') || '').toLowerCase();
        const multipart = enctype === 'multipart/form-data';

        const entries = formEntries(form, submitter, multipart);

        // CSRF is about protecting OUR endpoint. A form aimed at another origin
        // must neither be blocked by our token policy nor be handed our token:
        // attaching it would export the visitor's double-submit secret to a
        // third party.
        const sameOrigin = action.origin === location.origin;
        const headers = { 'X-Requested-With': 'XMLHttpRequest' };

        if (sameOrigin) {
          const csrfToken = readFormCsrfToken(form);
          const noCsrf = form.getAttribute('data-no-csrf') === 'true';
          if (!csrfToken && !noCsrf) {
            console.warn(
              '[what] Form submission blocked: no CSRF token found. ' +
              'Add a <meta name="what-csrf-token"> tag (csrfMetaTag() emits it) ' +
              'or set data-no-csrf="true" on the form to opt out.'
            );
            form.dispatchEvent(new CustomEvent('form:error', {
              bubbles: true,
              detail: { error: new Error('Missing CSRF token') },
            }));
            return;
          }
          if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
        }

        let body;
        if (method === 'GET') {
          // A native GET submit REPLACES the query string with the form data.
          // The previous code built the params and then threw them away, so an
          // enhanced GET form fetched a bare URL with none of its fields.
          action.search = String(entries);
        } else if (multipart) {
          // Hand FormData straight to fetch so the browser writes the boundary.
          body = entries;
        } else {
          body = entries;
          headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
        }

        const response = await fetch(action.href, {
          method,
          body,
          headers,
          credentials: 'same-origin',
        });

        const responseEvent = new CustomEvent('form:response', {
          bubbles: true,
          cancelable: true,
          detail: { response, ok: response.ok, redirected: response.redirected },
        });
        const proceed = form.dispatchEvent(responseEvent);

        // Same-origin only. A native submit would follow an off-site redirect,
        // but a framework default that can navigate the page to another origin
        // on a server's say-so is not a default worth having. Listen for
        // form:response if you need that.
        if (proceed && response.ok && response.redirected) {
          /** @type {string | null} */
          let target = null;
          try {
            const url = new URL(response.url, location.href);
            if (url.origin === location.origin) target = url.href;
          } catch { /* unparseable: do not navigate */ }
          if (target) location.assign(target);
        }
      } catch (error) {
        form.dispatchEvent(new CustomEvent('form:error', {
          bubbles: true,
          detail: { error },
        }));
      }
    });
  });
}

// --- Debugging ---

export function getIslandStatus() {
  const stores = [...(currentStoreMap()?.keys() || serverStoreDefinitions.keys())];
  const status = {
    registered: [...islandRegistry.keys()],
    hydrated: hydratedIslands.size,
    pending: hydrationQueue.length,
    queue: hydrationQueue.map(t => ({ name: t.name, priority: t.priority })),
    stores,
  };
  return status;
}
