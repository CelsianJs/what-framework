// What Framework - Component Utilities
// memo, lazy, Suspense, ErrorBoundary

import { h, _vnode } from './h.js';
import {
  signal, effect, untrack, getOwner, runWithOwner, createRoot, onCleanup, _handleError, _isDisposed, HANDLED,
  _trackWork, _beginWork, _retryErrors, _errorSource, _setUserEffectGate, _releaseUserEffect,
  _committingTransition, __DEV__, __devtools,
} from './reactive.js';
import { report, recordObservation } from './diagnostics.js';
import { isServerRender } from './server-context.js';
import { hydrate, insert, _enableSuspense, _hydrationErrorHook } from './render.js';
import { createDOM, _handleNavigationSignal } from './dom.js';

// --- memo ---
// In the run-once model, components execute exactly once and never re-render.
// Signals update the DOM directly via fine-grained effects. Therefore, memo()
// is a no-op identity wrapper — there is no re-render to skip.
// Kept for API compatibility with React-style code.

export function memo(Component, _areEqual) {
  // No-op in run-once model — just return the component as-is
  const MemoWrapper = function MemoWrapper(props) {
    return Component(props);
  };
  MemoWrapper.displayName = `Memo(${Component.name || 'Anonymous'})`;
  return MemoWrapper;
}

export function shallowEqual(a, b) {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

// --- lazy ---
// Code-split a component. Returns a wrapper that loads on first render.

export function lazy(loader) {
  _enableSuspense();
  let Component = null;
  let loadPromise = null;
  let loadError = null;
  const listeners = new Set();

  function LazyWrapper(props) {
    if (loadError) throw loadError;
    if (Component) return h(Component, props);

    if (!loadPromise) {
      loadPromise = loader()
        .then(mod => {
          Component = mod.default || mod;
          // Notify all waiting instances
          listeners.forEach(fn => fn());
          listeners.clear();
        })
        .catch(err => { loadError = err; });
    }

    // Throw promise for Suspense to catch
    throw loadPromise;
  }

  LazyWrapper.displayName = 'Lazy';
  LazyWrapper._lazy = true;
  LazyWrapper._onLoad = (fn) => {
    if (Component) fn();
    else listeners.add(fn);
  };
  return LazyWrapper;
}

// A boundary's context only exists once the vnode renderer builds it
// (createSuspenseBoundary / createErrorBoundary), so compiled children must
// not be built while the boundary function runs: it receives the children
// factory instead. See _installLazyChildren. Marked through a call rather than
// a top-level statement so a bundle that never uses the boundary drops it, and
// the vnode renderer with it.
function deferChildren(Component) {
  Component._deferChildren = true;
  return Component;
}

// The built-ins what-compiler lowers away (compiled JSX renders <Show>,
// <For>, <Switch> and <Match> as a conditional or a list, with no component
// of its own) take no step in owner paths when they run as components, so a
// subtree has the same paths and hydration keys whichever way each side
// rendered it (hydration-data.js _assignOwnerPath).
function lowered(Component) {
  Component._lowered = true;
  return Component;
}

// --- Suspense ---
// <Suspense fallback>: shows `fallback` until its children have first shown.
// The children are built once, out of the document, under an owner whose
// `_onPending` handler hears of every binding or effect held on a value that
// has not landed, and every component that suspended (threw a promise: lazy(),
// use(), a not-ready read in its body, which render.js renders again in place
// once it settles). A held binding counts until a run of it completes (a
// value computed from another async value keeps it waiting through that
// value's own fetch), fails, or it is disposed; a suspended component until it
// has rendered again, or its place is gone. While any of them waits, the
// fallback stands in; when none does, after the flush that let the last one
// go, the children's DOM is moved in and the boundary is revealed. settled()
// counts that reveal as work, so it resolves after the effects it releases
// have run.
//
// After that, async values never bring the fallback back: a refresh keeps the
// children mounted, their bindings hold what they show until the new value
// lands, and a binding or component that waits on a value later renders
// nothing in the meantime. A component that suspends on any other promise (a
// lazy() chunk, use(promise)) does, as in React: the children's DOM is moved
// out, still mounted, while the fallback shows, and back once what the
// boundary waits for has settled. onMount and useEffect under a boundary that
// is not showing its children first run when it does.
//
// The vnode carries the boundary, and the boundary its client renderer
// (`mount`), so a bundle that never uses Suspense does not carry it. A
// renderer sets `show` and `conceal`, which move the children in and out;
// hydration (render.js hydrateSuspense) sets them too, and tells the boundary
// when the walk of its children is over (`walked`).

export const Suspense = /* @__PURE__ */ deferChildren(function Suspense({ fallback, children }) {
  return _vnode('__suspense', { fallback, boundary: createSuspense(fallback) }, Array.isArray(children) ? children : [children]);
});

// Boundaries built and not revealed yet; the user-effect gate looks only while
// there is one.
let unrevealed = 0;

// A user-phase effect created under a boundary that has not revealed waits for
// it: the outermost such boundary, which hands it on to the next one that
// still has not, if any, when it reveals.
function gateUserEffect(e) {
  if (unrevealed === 0) return false;
  /** @type {any} */
  let target = null;
  for (let o = e.owner; o != null; o = o.owner) {
    const b = o._suspense;
    if (b !== undefined && !b.revealed) target = b;
  }
  if (target === null) return false;
  target.deferred.push(e);
  return true;
}

// A promise a component suspended on is the app's: it reaches the boundary
// through `link`, which the boundary empties when it goes, so one that never
// settles keeps nothing of it. Its own scope, so the callbacks hold `link` and
// nothing else.
function awaitSuspended(waiting, link) {
  const done = () => {
    const b = link.b;
    if (b === null) return;
    b.links.delete(link);
    b.thenables--;
    b.check();
  };
  waiting.then(done, done);
}

function createSuspense(fallback) {
  _enableSuspense();
  const b = {
    fallback,
    revealed: false,
    hydrating: false,
    /** @type {Set<any>} held effects and bindings that have not completed a run since */
    waiting: new Set(),
    /** promises of suspended components not settled yet */
    thenables: 0,
    /** @type {Set<{ b: any }>} what each of those promises reaches the boundary through */
    links: new Set(),
    /** @type {any[]} user-phase effects waiting for the reveal */
    deferred: [],
    /** @type {(() => void) | null} */
    show: null,
    /** @type {(() => void) | null} */
    conceal: null,
    attached: false,
    queued: false,
    // `waiting` is a promise a component suspended on, or an effect or
    // binding held on a value that is not ready. For an effect it counts,
    // it returns the function the engine calls when the effect stops waiting.
    onPending(waiting) {
      if (b.revealed) {
        if (waiting.showsFallback !== true) return null;
        if (__DEV__ && _committingTransition()) report('ERR_SUSPEND_IN_TRANSITION', { data: { component: waiting.component } });
        b.revealed = false;
        unrevealed++;
        // The component is being built inside a region that is running; the
        // fallback goes in once that run is over, unless the boundary has
        // shown its children again, or gone, by then.
        queueMicrotask(() => {
          if (!b.revealed && b.conceal !== null) b.conceal();
        });
      }
      if (__DEV__) recordObservation(__devtools, 'suspense:waiting', b, /** @type {any} */ (b).devOwner);
      if (typeof waiting.then !== 'function') {
        b.waiting.add(waiting);
        return b.release;
      }
      // It settles once the component has rendered again (or its place is
      // gone): that render's own waits are counted by now.
      b.thenables++;
      _trackWork(waiting);
      const link = { b };
      b.links.add(link);
      awaitSuspended(waiting, link);
      return null;
    },
    // A counted effect completed a run, failed, or was disposed. Look again
    // after the flush that is running (or the current task), when every
    // binding that runs in it has run, and count the look as work settled()
    // waits for.
    release(e) {
      b.waiting.delete(e);
      b.schedule();
    },
    schedule() {
      if (b.queued || b.revealed) return;
      b.queued = true;
      const done = _beginWork();
      queueMicrotask(() => {
        b.queued = false;
        b.check();
        done();
      });
    },
    check() {
      if (b.revealed || b.hydrating) return;
      for (const e of b.waiting) if (_isDisposed(e)) b.waiting.delete(e);
      if (b.waiting.size === 0 && b.thenables === 0) b.reveal();
    },
    reveal() {
      b.revealed = true;
      if (__DEV__) recordObservation(__devtools, 'suspense:revealed', b, /** @type {any} */ (b).devOwner);
      unrevealed--;
      if (b.show !== null) b.show();
      const deferred = b.deferred;
      b.deferred = [];
      for (const e of deferred) if (!gateUserEffect(e)) _releaseUserEffect(e);
    },
    // Start counting: the children are about to be built under `root`.
    attach(root, hydrating) {
      root._onPending = b.onPending;
      root._suspense = b;
      if (b.revealed || b.attached) return;
      b.attached = true;
      b.hydrating = hydrating;
      unrevealed++;
      _setUserEffectGate(gateUserEffect);
      // Until the boundary itself goes: hydration replaces the arm `root` holds.
      runWithOwner(root.owner, () => onCleanup(() => {
        for (const link of b.links) link.b = null;
        b.links.clear();
        if (!b.revealed) {
          b.revealed = true;
          if (__DEV__) recordObservation(__devtools, 'suspense:disposed', b);
          unrevealed--;
        }
      }));
    },
    // Hydration: the children have been walked. The server's content is on
    // screen unless a component suspended, so that is the reveal; a binding
    // waiting for a value only the client fetches keeps the server's content
    // up meanwhile.
    walked() {
      b.hydrating = false;
      if (b.thenables === 0) {
        b.waiting.clear();
        if (!b.revealed) b.reveal();
      }
    },
    mount: mountSuspense,
  };
  if (__DEV__) /** @type {any} */ (b).devOwner = getOwner();
  return b;
}

// Build `vnodes` before `end` in a root of their own; returns its disposer.
function buildArm(vnodes, end) {
  return createRoot((dispose) => {
    for (const v of Array.isArray(vnodes) ? vnodes : [vnodes]) {
      const node = createDOM(v, end.parentNode);
      if (node) end.parentNode.insertBefore(node, end);
    }
    return dispose;
  });
}

// The client render of a boundary: <!--sb:start--> fallback or children <!--sb:end-->.
function mountSuspense(vnode, parent) {
  const b = vnode.props.boundary;
  const owner = getOwner();
  const start = document.createComment('sb:start');
  const end = document.createComment('sb:end');
  const container = document.createDocumentFragment();
  container.appendChild(start);
  container.appendChild(end);
  const holder = document.createDocumentFragment();
  createRoot(() => {
    b.attach(getOwner(), false);
    for (const v of vnode.children) {
      const node = createDOM(v, parent);
      if (node) holder.appendChild(node);
    }
  });
  /** @type {(() => void) | null} */
  let fallbackArm = null;
  b.show = () => {
    if (fallbackArm !== null) {
      fallbackArm();
      fallbackArm = null;
      for (let n = start.nextSibling; n !== null && n !== end; n = start.nextSibling) n.remove();
    }
    /** @type {Node} */ (end.parentNode).insertBefore(holder, end);
  };
  b.conceal = () => {
    for (let n = start.nextSibling; n !== null && n !== end; n = start.nextSibling) holder.appendChild(n);
    fallbackArm = runWithOwner(owner, () => buildArm(b.fallback, end));
  };
  b.check();
  if (!b.revealed) fallbackArm = buildArm(b.fallback, end);
  onCleanup(() => { if (fallbackArm !== null) fallbackArm(); });
  return container;
}

// --- ErrorBoundary ---
// Catch errors in children and show fallback. The renderers install
// `handleError` on the owner its children are built under
// (createErrorBoundary below, render.js hydrateErrorBoundary), so an error thrown while the
// children are built, or later by an effect, a binding, a cleanup, a list row,
// a component created inside them or an async value they read, reaches it.
// `reset` fetches again the async values whose errors it caught, disposes the
// fallback and builds the children again.

export const ErrorBoundary = /* @__PURE__ */ deferChildren(function ErrorBoundary({ fallback, children, onError }) {
  const errorState = signal(null);
  // The async computed runs that failed with the errors it caught.
  /** @type {Array<{ node: any, run: number }>} */
  const caught = [];

  // Error handler that will be registered with the component tree
  const handleError = (error) => {
    const source = _errorSource(error);
    if (source !== null) caught.push(source);
    errorState.set(error);
    if (onError) {
      try {
        onError(error);
      } catch (e) {
        console.error('Error in onError handler:', e);
      }
    }
  };

  // Reset function to recover from error
  const reset = () => {
    _retryErrors(caught.splice(0));
    errorState.set(null);
  };

  return _vnode('__errorBoundary', { errorState, handleError, fallback, reset, mount: createErrorBoundary }, Array.isArray(children) ? children : [children]);
});

// The client render of a boundary, which its vnode carries (`mount`) as
// Suspense's does: <!--eb:start--> arm <!--eb:end-->. An effect shows the arm
// `errorState` names and rebuilds it when the state changes. Each arm is built
// in a root owned by the run that builds it, so the next run, or the
// boundary's disposal, disposes the arm before another takes its place.
// `handleError` goes on the root of the children's arm (`_onError`), which is
// how an error anywhere under the children finds it, and why one in the
// fallback goes past it to the boundary above.
function createErrorBoundary(vnode, parent) {
  const { errorState, handleError, fallback, reset } = vnode.props;
  const children = vnode.children;
  const start = document.createComment('eb:start');
  const end = document.createComment('eb:end');
  const container = document.createDocumentFragment();
  container.appendChild(start);
  container.appendChild(end);
  effect(() => {
    const error = errorState();
    for (let n = start.nextSibling; n !== null && n !== end; n = start.nextSibling) n.remove();
    untrack(() => {
      if (error) {
        buildErrorArm(typeof fallback === 'function' ? fallback({ error, reset }) : fallback, parent, end, null);
        return;
      }
      try {
        buildErrorArm(children, parent, end, handleError);
      } catch (err) {
        if (_handleNavigationSignal(err)) return;
        handleError(err);
      }
    });
  });
  return container;
}

// Build `vnodes` before `end` in a root of their own, with `onError` (when
// given) as the root's error handler.
function buildErrorArm(vnodes, parent, end, onError) {
  createRoot(() => {
    if (onError !== null) /** @type {any} */ (getOwner())._onError = onError;
    for (const v of Array.isArray(vnodes) ? vnodes : [vnodes]) {
      const node = createDOM(v, parent);
      if (node) end.parentNode.insertBefore(node, end);
    }
  });
}

// Hand an error to the nearest error boundary above `owner` (the current owner
// by default). Returns true when a boundary took it.
export function reportError(error, owner) {
  return _handleError(owner === undefined ? getOwner() : owner, error) === HANDLED;
}

// --- Show ---
// Conditional rendering component. Cleaner than ternaries.
//
// Components run ONCE and never re-execute, so reading `when()` in the body
// would snapshot the condition a single time — the content would render once
// and never advance when the signal flips (the classic `<Show when={() =>
// authed()}>` identity-gate trap). Instead we return a reactive THUNK: when a
// component returns a function, createDOM installs a fine-grained fn-child
// effect (packages/core/src/dom.js) that re-evaluates it — the same reactive
// form the fine-grained compiler lowers `<Show>` to. Works on both JSX
// pipelines (the babel plugin lowers inline; the automatic `jsxImportSource`
// runtime / h() route here via _$createComponent).

export const Show = /* @__PURE__ */ lowered(function Show({ when, fallback = null, children }) {
  return () => {
    // `when` can be a signal getter, a plain thunk, or a static value.
    const condition = typeof when === 'function' ? when() : when;
    return condition ? children : fallback;
  };
});

// --- For ---
// List rendering. Returns a reactive thunk (see Show above) so the list
// re-renders when `each` changes. The thunk re-reads `each()` inside the
// framework's fn-child effect, tracking it. The preferred, keyed-efficient
// pattern is `.map()` with a `key` prop (auto-lowered to _$mapArray by the
// compiler) or `<For>` compiled by the fine-grained plugin; this runtime form
// is the fallback for the automatic JSX runtime / h() path. With `key`, it
// gives each row its item as an accessor, as the compiled <For> does: a row
// is built once per key, and follows an item replaced under that key.

export const For = /* @__PURE__ */ lowered(function For({ each, key, fallback = null, children }) {
  // children should be a function (item, index) => vnode. Resolve/validate it
  // once at creation — it does not change across list updates.
  const renderFn = Array.isArray(children) ? children[0] : children;
  if (typeof renderFn !== 'function') {
    console.warn('[what] For: children must be a render function, e.g. <For each={items}>{(item) => ...}</For>');
    return fallback;
  }
  if (typeof key === 'function') return keyedFor(each, key, fallback, renderFn);

  return () => {
    const list = typeof each === 'function' ? each() : each;
    if (!list || list.length === 0) return fallback;

    return list.map((item, index) => {
      const vnode = renderFn(item, index);
      // Auto-detect keys for efficient keyed reconciliation
      if (vnode && typeof vnode === 'object' && vnode.key == null) {
        if (item != null && typeof item === 'object') {
          // Use item.id or item.key if available
          if (item.id != null) vnode.key = item.id;
          else if (item.key != null) vnode.key = item.key;
        } else if (typeof item === 'string' || typeof item === 'number') {
          // Primitive items can be their own key. Like the items of an unkeyed
          // list they may repeat, which is not a duplicate-key mistake.
          vnode.key = item;
          vnode._itemKey = true;
        }
      }
      return vnode;
    });
  };
});

// <For key>: the vnode of each key is made once, from an accessor of the
// item, and handed back on every run, so the keyed rows keep it (and its DOM)
// while the accessor follows the item.
function keyedFor(each, key, fallback, renderFn) {
  /** @type {Map<any, { item: any, vnode: any }>} */
  let rows = new Map();
  return () => {
    const list = typeof each === 'function' ? each() : each;
    /** @type {Map<any, { item: any, vnode: any }>} */
    const next = new Map();
    if (!list || list.length === 0) {
      rows = next;
      return fallback;
    }
    const out = list.map((item, index) => {
      const k = key(item);
      let row = rows.get(k);
      if (row === undefined || next.has(k)) {
        const cell = signal(item);
        row = { item: cell, vnode: untrack(() => renderFn(() => cell(), index)) };
        if (row.vnode && typeof row.vnode === 'object') row.vnode.key = k;
      } else {
        row.item(item);
      }
      next.set(k, row);
      return row.vnode;
    });
    rows = next;
    return out;
  };
}

// --- Switch / Match ---
// Multi-condition rendering (like switch statement).

export const Switch = /* @__PURE__ */ lowered(function Switch({ fallback = null, children }) {
  // The Match children are static, so resolve them once. The match loop, which
  // reads each Match's reactive `when`, must run inside a reactive thunk (see
  // Show/For above): components run once, so evaluating `when()` in the body
  // here would snapshot the active arm a single time and `<Switch>`/`<Match
  // when={() => sig()}>` would render once and never update.
  // This is the runtime path, for h() and the automatic JSX runtime, where a
  // <Match> arrives as an unexecuted marker vnode. The fine-grained compiler
  // lowers <Switch> to the same conditional thunk and never reaches here; a
  // <Switch> it cannot lower is a build error rather than a call into this.
  const kids = Array.isArray(children) ? children : [children];

  return () => {
    for (const child of kids) {
      if (child && child.tag === Match) {
        const when = child.props.when;
        const condition = typeof when === 'function' ? when() : when;
        if (condition) return child.children;
      }
    }
    return fallback;
  };
});

export const Match = /* @__PURE__ */ lowered(function Match(props) {
  // Executed rather than left as a marker, which is what a lone compiled
  // <Match> does. Returning a `{ tag: Match }` vnode here would send createDOM
  // straight back into Match forever, so return a reactive thunk that renders
  // the arm when it matches.
  return () => {
    const condition = typeof props.when === 'function' ? props.when() : props.when;
    return condition ? props.children : null;
  };
});

// --- _$Island ---
// Islands architecture: the content ships as server-rendered HTML and only the
// *interactivity* is deferred to a client trigger. The babel plugin compiles
// `<Counter client:idle />` into h(_$Island, { component: Counter, mode: 'idle' }),
// importing it from what-framework/render. The public island component, which
// hydrates through the island registry, is what-framework/server's Island.

// Island props cross the server/client boundary as JSON, so anything that is not
// representable is dropped rather than throwing mid-render. Functions in
// particular are common (event handlers passed down) and are simply not
// transferable: the island re-creates its own handlers when it hydrates.
function serializeIslandProps(props) {
  const out = {};
  for (const key in props) {
    const value = props[key];
    if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) continue;
    out[key] = value;
  }
  try {
    return JSON.stringify(out);
  } catch {
    return '{}';
  }
}

export const _$Island = /* @__PURE__ */ deferChildren(function Island({ component: Component, mode, mediaQuery, name, children, ...props }) {
  const islandName = name || Component?.name || 'Island';
  const resolvedMode = mode || 'idle';

  const marker = {
    'data-island': islandName,
    'data-island-mode': resolvedMode,
    'data-hydrate': resolvedMode,
    // Tells hydrateIslands() to leave this element alone: a compiler-emitted
    // island holds a direct component reference and hydrates itself, so it
    // needs no registry entry and must not be claimed twice.
    'data-island-self': '1',
  };

  // Server: render the island's HTML inline, inside the marker. An island that
  // emits nothing costs SEO and LCP to buy lazy hydration, which is a strictly
  // worse trade than not using the directive at all.
  // Children arrive as props here but must be handed to the component
  // positionally: the renderers rebuild `props.children` from the vnode's own
  // children list, so anything passed through props alone is overwritten.
  const childList = children == null ? [] : (Array.isArray(children) ? children : [children]);

  if (isServerRender()) {
    return h(
      'div',
      { ...marker, 'data-island-props': serializeIslandProps(props) },
      h(Component, props, ...childList)
    );
  }

  let hydrated = false;
  // The island's content hydrates long after this body ran, under the island's
  // owner, so it is disposed with the island and finds its context, and its
  // mismatches go where those of the hydrate() that ran this body go.
  const owner = getOwner();
  const onHydrationError = _hydrationErrorHook();

  function hydrateInto(el) {
    if (hydrated || (owner !== null && _isDisposed(owner))) return;
    hydrated = true;

    const vnode = h(Component, props, ...childList);

    // Server-rendered children present => hydrate in place, reusing the DOM.
    // Nothing there => a client-only render, so build it from scratch.
    runWithOwner(owner, () => {
      if (el.childNodes.length > 0) {
        hydrate(vnode, el, onHydrationError === null ? undefined : { onHydrationError });
      } else {
        insert(el, vnode, null);
      }
    });

    el.removeAttribute('data-hydrate');
    el.removeAttribute('data-island-self');
    el.setAttribute('data-island-hydrated', '');
    // Build the event in the element's own realm. A global CustomEvent belongs
    // to a different realm inside an iframe or a DOM shim, and dispatchEvent
    // rejects it as "not of type 'Event'".
    const view = el.ownerDocument?.defaultView ?? globalThis;
    if (typeof view.CustomEvent === 'function') {
      el.dispatchEvent(new view.CustomEvent('island:hydrated', {
        bubbles: true,
        detail: { name: islandName, mode: resolvedMode },
      }));
    }
  }

  function scheduleHydration(el) {
    const trigger = () => hydrateInto(el);

    switch (resolvedMode) {
      case 'load':
        queueMicrotask(trigger);
        break;

      case 'idle':
        if (typeof requestIdleCallback !== 'undefined') requestIdleCallback(trigger);
        else setTimeout(trigger, 200);
        break;

      case 'visible': {
        if (typeof IntersectionObserver === 'undefined') { queueMicrotask(trigger); break; }
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            trigger();
          }
        }, { rootMargin: '200px' });
        observer.observe(el);
        break;
      }

      case 'interaction':
      case 'action': {
        // In the capture phase: focus does not bubble, and the island
        // hydrates before the event reaches its target, so the handler the
        // island sets on the target runs for the interaction that woke it.
        const events = ['click', 'focus', 'mouseenter', 'touchstart'];
        const onInteract = () => {
          for (const type of events) el.removeEventListener(type, onInteract, true);
          trigger();
        };
        for (const type of events) el.addEventListener(type, onInteract, { capture: true, once: true });
        break;
      }

      case 'media': {
        if (!mediaQuery || typeof window === 'undefined' || !window.matchMedia) { trigger(); break; }
        const mq = window.matchMedia(mediaQuery);
        if (mq.matches) { queueMicrotask(trigger); break; }
        const onChange = () => {
          if (!mq.matches) return;
          mq.removeEventListener('change', onChange);
          trigger();
        };
        mq.addEventListener('change', onChange);
        break;
      }

      // 'static' ships no JS at all: the server HTML is the whole island.
      case 'static':
        break;

      default:
        queueMicrotask(trigger);
    }
  }

  return h('div', { ...marker, ref: (el) => { if (el) scheduleHydration(el); } });
});
