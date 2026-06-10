import {
  _$createComponent,
  _$templateImpl,
  _setTextInsertHook,
  classList,
  delegateEvents,
  hydrate,
  insert,
  isHydrating,
  mapArray,
  on,
  setProp,
  spread,
  svgTemplate,
  template
} from "./chunk-H3GA34JK.js";
import {
  ErrorBoundary,
  For,
  Island,
  Match,
  Portal,
  Show,
  Suspense,
  Switch,
  __DEV__,
  __drainPreinstallBuffer,
  __setDevToolsHooks,
  batch,
  cls,
  computed,
  createRoot,
  debounce,
  each,
  effect,
  flushSync,
  getCurrentComponent,
  getOwner,
  lazy,
  memo,
  memo2,
  mount,
  onCleanup,
  runWithOwner,
  signal,
  style,
  throttle,
  transition,
  untrack,
  useClickOutside,
  useLocalStorage,
  useMediaQuery
} from "./chunk-GZRA4IAJ.js";
import {
  Fragment,
  h,
  html
} from "./chunk-AZP2EOGX.js";

// packages/core/src/server-context.js
var _current = null;
function getServerContext() {
  return _current;
}
function setServerContext(ctx) {
  const prev = _current;
  _current = ctx;
  return prev;
}
function runWithServerContext(ctx, fn) {
  const prev = _current;
  _current = ctx;
  try {
    return fn();
  } finally {
    _current = prev;
  }
}

// packages/core/src/hydration-data.js
var _cache;
function __readHydrationData() {
  if (_cache !== void 0) return _cache;
  if (typeof document === "undefined") return _cache = null;
  const el = document.getElementById("__what_data");
  if (!el) return _cache = null;
  try {
    _cache = JSON.parse(el.textContent);
  } catch {
    _cache = null;
  }
  return _cache;
}
function __resetHydrationData() {
  _cache = void 0;
}
function getLoaderData() {
  const data = __readHydrationData();
  return data ? data.loaderData : void 0;
}
function getResource(key) {
  const data = __readHydrationData();
  return data && data.resources ? data.resources[key] : void 0;
}

// packages/core/src/hooks.js
function useLoaderData() {
  if (typeof document === "undefined") {
    const ctx = getServerContext();
    return ctx ? ctx.loaderData : void 0;
  }
  return getLoaderData();
}
function getCtx(hookName) {
  const ctx = getCurrentComponent();
  if (!ctx) {
    throw new Error(
      `[what] ${hookName || "Hook"}() can only be called inside a component function. Did you call it outside of a component or in an async callback? If you need reactive state outside a component, use signal() directly.`
    );
  }
  return ctx;
}
function getHook(ctx) {
  const index = ctx.hookIndex++;
  return { index, exists: index < ctx.hooks.length };
}
function useState(initial) {
  const ctx = getCtx("useState");
  const { index, exists } = getHook(ctx);
  if (!exists) {
    const s2 = signal(typeof initial === "function" ? initial() : initial);
    ctx.hooks[index] = s2;
  }
  const s = ctx.hooks[index];
  return [s, s.set];
}
function useSignal(initial) {
  const ctx = getCtx("useSignal");
  const { index, exists } = getHook(ctx);
  if (!exists) {
    ctx.hooks[index] = signal(typeof initial === "function" ? initial() : initial);
  }
  return ctx.hooks[index];
}
function useComputed(fn) {
  const ctx = getCtx("useComputed");
  const { index, exists } = getHook(ctx);
  if (!exists) {
    ctx.hooks[index] = computed(fn);
  }
  return ctx.hooks[index];
}
function useEffect(fn, deps) {
  const ctx = getCtx("useEffect");
  const { index, exists } = getHook(ctx);
  if (!exists) {
    ctx.hooks[index] = { cleanup: null, dispose: null };
  }
  if (__DEV__ && Array.isArray(deps) && deps.length > 0) {
    for (let i = 0; i < deps.length; i++) {
      const dep = deps[i];
      if (dep != null && typeof dep !== "function") {
        console.warn(
          `[what] useEffect dep at index ${i} is not a function. Did you mean to pass a signal? Use count instead of count()`
        );
      }
    }
  }
  const hook = ctx.hooks[index];
  if (hook.dispose) return;
  if (deps === void 0) {
    queueMicrotask(() => {
      if (ctx.disposed) return;
      hook.dispose = effect(() => {
        if (hook.cleanup) {
          try {
            hook.cleanup();
          } catch (e) {
          }
          hook.cleanup = null;
        }
        const result = fn();
        if (typeof result === "function") hook.cleanup = result;
      });
      ctx.effects = ctx.effects || [];
      ctx.effects.push(hook.dispose);
    });
  } else if (deps.length === 0) {
    queueMicrotask(() => {
      if (ctx.disposed) return;
      const result = fn();
      if (typeof result === "function") hook.cleanup = result;
    });
    hook.dispose = true;
  } else {
    queueMicrotask(() => {
      if (ctx.disposed) return;
      hook.dispose = effect(() => {
        for (let i = 0; i < deps.length; i++) {
          const dep = deps[i];
          if (typeof dep === "function" && dep._signal) {
            dep();
          }
        }
        if (hook.cleanup) {
          try {
            hook.cleanup();
          } catch (e) {
          }
          hook.cleanup = null;
        }
        const result = untrack(() => fn());
        if (typeof result === "function") hook.cleanup = result;
      });
      ctx.effects = ctx.effects || [];
      ctx.effects.push(hook.dispose);
    });
  }
}
function useMemo(fn, deps) {
  const ctx = getCtx("useMemo");
  const { index, exists } = getHook(ctx);
  if (!exists) {
    ctx.hooks[index] = { computed: computed(fn) };
  }
  return ctx.hooks[index].computed;
}
function useCallback(fn, deps) {
  const ctx = getCtx("useCallback");
  const { index, exists } = getHook(ctx);
  if (!exists) {
    ctx.hooks[index] = { callback: fn };
  }
  return ctx.hooks[index].callback;
}
function useRef(initial) {
  const ctx = getCtx("useRef");
  const { index, exists } = getHook(ctx);
  if (!exists) {
    ctx.hooks[index] = { current: initial };
  }
  return ctx.hooks[index];
}
function useContext(context) {
  let ctx = getCurrentComponent();
  if (__DEV__ && !ctx) {
    console.warn(
      `[what] useContext(${context?.displayName || "Context"}) called outside of component render. useContext must be called during component rendering, not inside effects or event handlers. Store the context value in a variable during render and use that variable in your callback.`
    );
  }
  while (ctx) {
    if (ctx._contextValues && ctx._contextValues.has(context)) {
      const val = ctx._contextValues.get(context);
      return val && val._signal ? val() : val;
    }
    ctx = ctx._parentCtx;
  }
  return context._defaultValue;
}
function createContext(defaultValue) {
  const context = {
    _defaultValue: defaultValue,
    Provider: ({ value, children }) => {
      const ctx = getCtx("Context.Provider");
      if (!ctx._contextValues) ctx._contextValues = /* @__PURE__ */ new Map();
      if (!ctx._contextSignals) ctx._contextSignals = /* @__PURE__ */ new Map();
      if (!ctx._contextSignals.has(context)) {
        const s = signal(value);
        ctx._contextSignals.set(context, s);
        ctx._contextValues.set(context, s);
      } else {
        ctx._contextSignals.get(context).set(value);
      }
      return children;
    },
    // React-compatible Consumer: <Context.Consumer>{value => ...}</Context.Consumer>
    Consumer: ({ children }) => {
      const value = useContext(context);
      return typeof children === "function" ? children(value) : children;
    }
  };
  return context;
}
function useReducer(reducer, initialState, init) {
  const ctx = getCtx("useReducer");
  const { index, exists } = getHook(ctx);
  if (!exists) {
    const initial = init ? init(initialState) : initialState;
    const s = signal(initial);
    const dispatch = (action) => {
      s.set((prev) => reducer(prev, action));
    };
    ctx.hooks[index] = { signal: s, dispatch };
  }
  const hook = ctx.hooks[index];
  return [hook.signal, hook.dispatch];
}
function onMount(fn) {
  const ctx = getCtx("onMount");
  if (!ctx.mounted) {
    ctx._mountCallbacks = ctx._mountCallbacks || [];
    ctx._mountCallbacks.push(fn);
  }
}
function onCleanup2(fn) {
  const ctx = getCtx("onCleanup");
  ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
  ctx._cleanupCallbacks.push(fn);
}
function createResource(fetcher, options = {}) {
  if (typeof document === "undefined") {
    const ctx2 = getServerContext();
    if (ctx2) {
      const key = options.key != null ? options.key : `__r${ctx2.resourceCounter++}`;
      const cached = ctx2.resources.get(key);
      if (cached && cached.status === "ready") {
        const accessor = () => cached.value;
        return [accessor, { loading: () => false, error: () => null, refetch: () => {
        }, mutate: () => {
        } }];
      }
      if (cached && cached.status === "error") {
        const accessor = () => void 0;
        return [accessor, { loading: () => false, error: () => cached.error, refetch: () => {
        }, mutate: () => {
        } }];
      }
      if (!cached) {
        const promise = Promise.resolve().then(() => fetcher(options.source ?? true, {})).then((v) => {
          ctx2.resources.set(key, { status: "ready", value: v });
        }).catch((e) => {
          ctx2.resources.set(key, { status: "error", error: e });
        });
        ctx2.resources.set(key, { status: "pending", promise });
        throw promise;
      }
      throw cached.promise;
    }
    if (options.initialValue != null) {
      const accessor = () => options.initialValue;
      return [accessor, { loading: () => false, error: () => null, refetch: () => {
      }, mutate: () => {
      } }];
    }
    throw Promise.resolve().then(() => fetcher(options.source ?? true, {}));
  }
  let seeded = options.initialValue;
  if (seeded == null && options.key != null) {
    const fromPayload = getResource(options.key);
    if (fromPayload !== void 0) seeded = fromPayload;
  }
  const data = signal(seeded ?? null);
  const loading = signal(seeded == null);
  const error = signal(null);
  let controller = null;
  const refetch = async (source) => {
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal: abortSignal } = controller;
    loading.set(true);
    error.set(null);
    try {
      const result = await fetcher(source, { signal: abortSignal });
      if (!abortSignal.aborted) {
        batch(() => {
          data.set(result);
          loading.set(false);
        });
      }
    } catch (e) {
      if (!abortSignal.aborted) {
        batch(() => {
          error.set(e);
          loading.set(false);
        });
      }
    }
  };
  const mutate2 = (value) => {
    data.set(typeof value === "function" ? value(data()) : value);
  };
  const ctx = getCurrentComponent?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => {
      if (controller) controller.abort();
    });
  }
  if (seeded == null) {
    refetch(options.source);
  }
  return [data, { loading, error, refetch, mutate: mutate2 }];
}

// packages/core/src/store.js
function derived(fn) {
  fn._storeComputed = true;
  return fn;
}
var _storeComputedWarned = false;
function storeComputed(fn) {
  if (!_storeComputedWarned) {
    _storeComputedWarned = true;
    console.warn("[what] storeComputed() is deprecated. Use derived() instead.");
  }
  return derived(fn);
}
function createStore(definition) {
  const signals = {};
  const computeds = {};
  const actions = {};
  const state = {};
  for (const [key, value] of Object.entries(definition)) {
    if (typeof value === "function" && value._storeComputed) {
      if (__DEV__ && value.length === 0) {
        console.warn(
          `[what] derived() for "${key}" should accept the state parameter, e.g. derived(state => ...).`
        );
      }
      computeds[key] = value;
    } else if (typeof value === "function") {
      actions[key] = value;
    } else {
      signals[key] = signal(value);
    }
  }
  for (const [key, fn] of Object.entries(computeds)) {
    const proxy = new Proxy({}, {
      get(_, prop) {
        if (signals[prop]) return signals[prop]();
        if (computeds[prop]) return computeds[prop]();
        return void 0;
      }
    });
    computeds[key] = computed(() => fn(proxy));
  }
  for (const [key, fn] of Object.entries(actions)) {
    actions[key] = (...args) => {
      let result;
      batch(() => {
        const proxy = new Proxy({}, {
          get(_, prop) {
            if (signals[prop]) return signals[prop].peek();
            if (computeds[prop]) return computeds[prop].peek();
            if (actions[prop]) return actions[prop];
            return void 0;
          },
          set(_, prop, val) {
            if (signals[prop]) signals[prop].set(val);
            return true;
          }
        });
        result = fn.apply(proxy, args);
      });
      return result;
    };
  }
  return function useStore() {
    const result = {};
    for (const [key, s] of Object.entries(signals)) {
      Object.defineProperty(result, key, { get: () => s(), enumerable: true });
    }
    for (const [key, c] of Object.entries(computeds)) {
      Object.defineProperty(result, key, { get: () => c(), enumerable: true });
    }
    for (const [key, fn] of Object.entries(actions)) {
      result[key] = fn;
    }
    return result;
  };
}
var _atomWarned = false;
function atom(initial) {
  if (!_atomWarned) {
    _atomWarned = true;
    console.warn("[what] atom() is deprecated. Use signal() directly instead.");
  }
  return signal(initial);
}

// packages/core/src/head.js
var headState = {
  title: null,
  metas: /* @__PURE__ */ new Map(),
  links: /* @__PURE__ */ new Map()
};
function Head({ title, meta, link, children }) {
  if (typeof document === "undefined") {
    const ctx = getServerContext();
    if (ctx && ctx.head) writeToSink(ctx.head, { title, meta, link });
    return children ?? null;
  }
  if (title) {
    document.title = title;
    headState.title = title;
  }
  if (meta) {
    for (const attrs of Array.isArray(meta) ? meta : [meta]) {
      const key = attrs.name || attrs.property || attrs.httpEquiv || JSON.stringify(attrs);
      setHeadTag("meta", key, attrs);
    }
  }
  if (link) {
    for (const attrs of Array.isArray(link) ? link : [link]) {
      const key = attrs.rel + (attrs.href || "");
      setHeadTag("link", key, attrs);
    }
  }
  return children || null;
}
function metaKey(attrs) {
  return attrs.name || attrs.property || attrs.httpEquiv || JSON.stringify(attrs);
}
function writeToSink(sink, { title, meta, link }) {
  if (title != null) sink.title = title;
  if (meta) {
    for (const attrs of Array.isArray(meta) ? meta : [meta]) {
      sink.metas.set(metaKey(attrs), attrs);
    }
  }
  if (link) {
    for (const attrs of Array.isArray(link) ? link : [link]) {
      sink.links.set(attrs.rel + (attrs.href || ""), attrs);
    }
  }
}
function beginHeadCollection() {
  return { title: null, metas: /* @__PURE__ */ new Map(), links: /* @__PURE__ */ new Map() };
}
function endHeadCollection(sink) {
  if (!sink) return "";
  let out = "";
  if (sink.title != null) out += `<title>${escapeHtml(String(sink.title))}</title>`;
  for (const attrs of sink.metas.values()) out += renderHeadTag("meta", attrs);
  for (const attrs of sink.links.values()) out += renderHeadTag("link", attrs);
  return out;
}
function renderHeadTag(tag, attrs) {
  let s = `<${tag}`;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    const name = k === "httpEquiv" ? "http-equiv" : k;
    s += ` ${name}="${escapeHtml(String(v))}"`;
  }
  return s + ">";
}
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function setHeadTag(tag, key, attrs) {
  const existing = document.head.querySelector(`[data-what-head="${key}"]`);
  if (existing) {
    updateElement(existing, attrs);
    return;
  }
  const el = document.createElement(tag);
  el.setAttribute("data-what-head", key);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  document.head.appendChild(el);
}
function updateElement(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (el.getAttribute(k) !== v) {
      el.setAttribute(k, v);
    }
  }
}
function clearHead() {
  const tags = document.head.querySelectorAll("[data-what-head]");
  for (const tag of tags) tag.remove();
  headState.metas.clear();
  headState.links.clear();
}

// packages/core/src/scheduler.js
var readQueue = [];
var writeQueue = [];
var scheduled = false;
function scheduleRead(fn) {
  readQueue.push(fn);
  schedule();
  return () => {
    const idx = readQueue.indexOf(fn);
    if (idx !== -1) readQueue.splice(idx, 1);
  };
}
function scheduleWrite(fn) {
  writeQueue.push(fn);
  schedule();
  return () => {
    const idx = writeQueue.indexOf(fn);
    if (idx !== -1) writeQueue.splice(idx, 1);
  };
}
function flushScheduler() {
  while (readQueue.length > 0) {
    const fn = readQueue.shift();
    try {
      fn();
    } catch (e) {
      console.error("[what] Scheduler read error:", e);
    }
  }
  while (writeQueue.length > 0) {
    const fn = writeQueue.shift();
    try {
      fn();
    } catch (e) {
      console.error("[what] Scheduler write error:", e);
    }
  }
  scheduled = false;
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(flushScheduler);
}
function measure(fn) {
  return new Promise((resolve) => {
    scheduleRead(() => {
      resolve(fn());
    });
  });
}
function mutate(fn) {
  return new Promise((resolve) => {
    scheduleWrite(() => {
      fn();
      resolve();
    });
  });
}
function useScheduledEffect(readFn, writeFn) {
  const effectKey = /* @__PURE__ */ Symbol("scheduledEffect");
  return effect(() => {
    raf(effectKey, () => {
      scheduleRead(() => {
        const data = readFn();
        if (writeFn) {
          scheduleWrite(() => writeFn(data));
        }
      });
    });
  });
}
function nextFrame() {
  let cancel;
  const promise = new Promise((resolve, reject) => {
    const id = requestAnimationFrame(resolve);
    cancel = () => {
      cancelAnimationFrame(id);
      reject(new Error("Cancelled"));
    };
  });
  promise.cancel = cancel;
  return promise;
}
var debouncedCallbacks = /* @__PURE__ */ new Map();
function raf(key, fn) {
  if (debouncedCallbacks.has(key)) {
    debouncedCallbacks.set(key, fn);
  } else {
    debouncedCallbacks.set(key, fn);
    requestAnimationFrame(() => {
      const callback = debouncedCallbacks.get(key);
      debouncedCallbacks.delete(key);
      if (callback) callback();
    });
  }
}
var resizeObservers = /* @__PURE__ */ new WeakMap();
var sharedResizeObserver = null;
function onResize(element, callback) {
  if (typeof ResizeObserver === "undefined") {
    callback(element.getBoundingClientRect());
    return () => {
    };
  }
  if (!sharedResizeObserver) {
    sharedResizeObserver = new ResizeObserver((entries) => {
      scheduleRead(() => {
        for (const entry of entries) {
          const cb = resizeObservers.get(entry.target);
          if (cb) {
            cb(entry.contentRect);
          }
        }
      });
    });
  }
  resizeObservers.set(element, callback);
  sharedResizeObserver.observe(element);
  return () => {
    resizeObservers.delete(element);
    sharedResizeObserver.unobserve(element);
  };
}
function onIntersect(element, callback, options = {}) {
  if (typeof IntersectionObserver === "undefined") {
    callback({ isIntersecting: true, intersectionRatio: 1 });
    return () => {
    };
  }
  const observer = new IntersectionObserver((entries) => {
    scheduleRead(() => {
      for (const entry of entries) {
        callback(entry);
      }
    });
  }, options);
  observer.observe(element);
  return () => observer.disconnect();
}
function smoothScrollTo(element, options = {}) {
  const { duration = 300, easing = (t) => t * (2 - t) } = options;
  return new Promise((resolve) => {
    let startY;
    let targetY;
    let startTime;
    scheduleRead(() => {
      startY = window.scrollY;
      const rect = element.getBoundingClientRect();
      targetY = startY + rect.top;
      startTime = performance.now();
      tick();
    });
    function tick() {
      scheduleRead(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easing(progress);
        const currentY = startY + (targetY - startY) * easedProgress;
        scheduleWrite(() => {
          window.scrollTo(0, currentY);
          if (progress < 1) {
            requestAnimationFrame(tick);
          } else {
            resolve();
          }
        });
      });
    }
  });
}

// packages/core/src/animation.js
function scopedEffect(fn) {
  const ctx = getCurrentComponent?.();
  const dispose = effect(fn);
  if (ctx) ctx.effects.push(dispose);
  return dispose;
}
function spring(initialValue, options = {}) {
  const {
    stiffness = 100,
    damping = 10,
    mass = 1,
    precision = 0.01
  } = options;
  const current = signal(initialValue);
  const target = signal(initialValue);
  const velocity = signal(0);
  const isAnimating = signal(false);
  let rafId = null;
  let lastTime = null;
  function tick(time) {
    if (lastTime === null) {
      lastTime = time;
      rafId = requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min((time - lastTime) / 1e3, 0.064);
    lastTime = time;
    const currentVal = current.peek();
    const targetVal = target.peek();
    const vel = velocity.peek();
    const displacement = currentVal - targetVal;
    const springForce = -stiffness * displacement;
    const dampingForce = -damping * vel;
    const acceleration = (springForce + dampingForce) / mass;
    const newVelocity = vel + acceleration * dt;
    const newValue = currentVal + newVelocity * dt;
    batch(() => {
      velocity.set(newVelocity);
      current.set(newValue);
    });
    if (Math.abs(newVelocity) < precision && Math.abs(displacement) < precision) {
      batch(() => {
        current.set(targetVal);
        velocity.set(0);
        isAnimating.set(false);
      });
      rafId = null;
      lastTime = null;
      return;
    }
    rafId = requestAnimationFrame(tick);
  }
  function set(newTarget) {
    target.set(newTarget);
    if (rafId === null) {
      isAnimating.set(true);
      lastTime = null;
      rafId = requestAnimationFrame(tick);
    }
  }
  function stop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    isAnimating.set(false);
    lastTime = null;
  }
  function snap(value) {
    stop();
    batch(() => {
      current.set(value);
      target.set(value);
      velocity.set(0);
    });
  }
  const ctx = getCurrentComponent?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(stop);
  }
  return {
    current: () => current(),
    target: () => target(),
    velocity: () => velocity(),
    isAnimating: () => isAnimating(),
    set,
    stop,
    snap,
    subscribe: current.subscribe
  };
}
function tween(from, to, options = {}) {
  const {
    duration = 300,
    easing = (t) => t * (2 - t),
    // easeOutQuad
    onUpdate,
    onComplete
  } = options;
  const progress = signal(0);
  const value = signal(from);
  const isAnimating = signal(true);
  let startTime = null;
  let rafId = null;
  function tick(time) {
    if (startTime === null) startTime = time;
    const elapsed = time - startTime;
    const t = Math.min(elapsed / duration, 1);
    const easedT = easing(t);
    const currentValue = from + (to - from) * easedT;
    batch(() => {
      progress.set(t);
      value.set(currentValue);
    });
    if (onUpdate) onUpdate(currentValue, t);
    if (t < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      isAnimating.set(false);
      if (onComplete) onComplete();
    }
  }
  rafId = requestAnimationFrame(tick);
  return {
    progress: () => progress(),
    value: () => value(),
    isAnimating: () => isAnimating(),
    cancel: () => {
      if (rafId) cancelAnimationFrame(rafId);
      isAnimating.set(false);
    },
    subscribe: value.subscribe
  };
}
var easings = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => --t * t * t + 1,
  easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeInElastic: (t) => t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * (2 * Math.PI / 3)),
  easeOutElastic: (t) => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1,
  easeOutBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};
function useTransition(options = {}) {
  const { duration = 300, easing = easings.easeOutQuad } = options;
  const isTransitioning = signal(false);
  const progress = signal(0);
  async function start(callback) {
    isTransitioning.set(true);
    progress.set(0);
    return new Promise((resolve) => {
      const startTime = performance.now();
      function tick(time) {
        const elapsed = time - startTime;
        const t = Math.min(elapsed / duration, 1);
        progress.set(easing(t));
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          isTransitioning.set(false);
          if (callback) callback();
          resolve();
        }
      }
      requestAnimationFrame(tick);
    });
  }
  return {
    isTransitioning: () => isTransitioning(),
    progress: () => progress(),
    start
  };
}
function useGesture(element, handlers = {}) {
  const {
    onDrag,
    onDragStart,
    onDragEnd,
    onPinch,
    onSwipe,
    onTap,
    onLongPress,
    preventDefault = false
    // Set to true to allow e.preventDefault() in touch handlers
  } = handlers;
  const state = {
    isDragging: signal(false),
    startX: 0,
    startY: 0,
    currentX: signal(0),
    currentY: signal(0),
    deltaX: signal(0),
    deltaY: signal(0),
    velocity: signal({ x: 0, y: 0 })
  };
  let lastTime = 0;
  let lastX = 0;
  let lastY = 0;
  let longPressTimer = null;
  function handleStart(e) {
    const touch = e.touches ? e.touches[0] : e;
    state.startX = touch.clientX;
    state.startY = touch.clientY;
    lastX = touch.clientX;
    lastY = touch.clientY;
    lastTime = performance.now();
    state.isDragging.set(true);
    if (onDragStart) onDragStart({ x: state.startX, y: state.startY });
    if (onLongPress) {
      longPressTimer = setTimeout(() => {
        if (state.isDragging.peek()) {
          onLongPress({ x: lastX, y: lastY });
        }
      }, 500);
    }
  }
  function handleMove(e) {
    if (!state.isDragging.peek()) return;
    const touch = e.touches ? e.touches[0] : e;
    const x = touch.clientX;
    const y = touch.clientY;
    const now = performance.now();
    const dt = now - lastTime;
    batch(() => {
      state.currentX.set(x);
      state.currentY.set(y);
      state.deltaX.set(x - state.startX);
      state.deltaY.set(y - state.startY);
      if (dt > 0) {
        state.velocity.set({
          x: (x - lastX) / dt * 1e3,
          y: (y - lastY) / dt * 1e3
        });
      }
    });
    lastX = x;
    lastY = y;
    lastTime = now;
    if (longPressTimer) {
      const distance = Math.sqrt(state.deltaX.peek() ** 2 + state.deltaY.peek() ** 2);
      if (distance > 10) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }
    if (onDrag) {
      onDrag({
        x,
        y,
        deltaX: state.deltaX.peek(),
        deltaY: state.deltaY.peek(),
        velocity: state.velocity.peek()
      });
    }
  }
  function handleEnd(e) {
    if (!state.isDragging.peek()) return;
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    const deltaX = state.deltaX.peek();
    const deltaY = state.deltaY.peek();
    const velocity = state.velocity.peek();
    const distance = Math.sqrt(deltaX ** 2 + deltaY ** 2);
    if (distance < 10 && onTap) {
      onTap({ x: state.startX, y: state.startY });
    }
    if (onSwipe && (Math.abs(velocity.x) > 500 || Math.abs(velocity.y) > 500)) {
      const direction = Math.abs(velocity.x) > Math.abs(velocity.y) ? velocity.x > 0 ? "right" : "left" : velocity.y > 0 ? "down" : "up";
      onSwipe({ direction, velocity });
    }
    if (onDragEnd) {
      onDragEnd({
        deltaX,
        deltaY,
        velocity
      });
    }
    state.isDragging.set(false);
  }
  let initialPinchDistance = null;
  function handlePinchMove(e) {
    if (!onPinch || e.touches.length !== 2) return;
    const touch1 = e.touches[0];
    const touch2 = e.touches[1];
    const distance = Math.sqrt(
      (touch2.clientX - touch1.clientX) ** 2 + (touch2.clientY - touch1.clientY) ** 2
    );
    if (initialPinchDistance === null) {
      initialPinchDistance = distance;
    }
    const scale = distance / initialPinchDistance;
    const centerX = (touch1.clientX + touch2.clientX) / 2;
    const centerY = (touch1.clientY + touch2.clientY) / 2;
    onPinch({ scale, centerX, centerY });
  }
  function handlePinchEnd() {
    initialPinchDistance = null;
  }
  if (typeof element === "function") {
    scopedEffect(() => {
      const el = untrack(element);
      if (!el) return;
      return attachListeners(el);
    });
  } else if (element?.current !== void 0) {
    scopedEffect(() => {
      const el = element.current;
      if (!el) return;
      return attachListeners(el);
    });
  } else if (element) {
    attachListeners(element);
  }
  function attachListeners(el) {
    el.addEventListener("mousedown", handleStart);
    el.addEventListener("touchstart", handleStart, { passive: !preventDefault });
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("touchmove", handlePinchMove);
    window.addEventListener("touchmove", handleMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchend", handleEnd);
    window.addEventListener("touchend", handlePinchEnd);
    return () => {
      el.removeEventListener("mousedown", handleStart);
      el.removeEventListener("touchstart", handleStart);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("touchmove", handlePinchMove);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchend", handleEnd);
      window.removeEventListener("touchend", handlePinchEnd);
    };
  }
  return state;
}
function useAnimatedValue(initialValue) {
  const value = signal(initialValue);
  const animations = [];
  return {
    value: () => value(),
    setValue: (v) => value.set(v),
    // Spring to target
    spring(toValue, config = {}) {
      const s = spring(value.peek(), config);
      s.set(toValue);
      const dispose = effect(() => {
        value.set(s.current());
      });
      return {
        stop: () => {
          s.stop();
          dispose();
        }
      };
    },
    // Tween to target
    timing(toValue, config = {}) {
      const t = tween(value.peek(), toValue, {
        ...config,
        onUpdate: (v) => value.set(v)
      });
      return {
        stop: () => t.cancel()
      };
    },
    // Interpolate value
    interpolate(inputRange, outputRange) {
      return () => {
        const v = value();
        for (let i = 0; i < inputRange.length - 1; i++) {
          if (v >= inputRange[i] && v <= inputRange[i + 1]) {
            const t = (v - inputRange[i]) / (inputRange[i + 1] - inputRange[i]);
            return outputRange[i] + (outputRange[i + 1] - outputRange[i]) * t;
          }
        }
        if (v <= inputRange[0]) return outputRange[0];
        return outputRange[outputRange.length - 1];
      };
    },
    subscribe: value.subscribe
  };
}
function createTransitionClasses(name) {
  return {
    enter: `${name}-enter`,
    enterActive: `${name}-enter-active`,
    enterDone: `${name}-enter-done`,
    exit: `${name}-exit`,
    exitActive: `${name}-exit-active`,
    exitDone: `${name}-exit-done`
  };
}
async function cssTransition(element, name, type = "enter", duration = 300) {
  const classes = createTransitionClasses(name);
  return new Promise((resolve) => {
    scheduleWrite(() => {
      element.classList.add(classes[type]);
      scheduleRead(() => {
        element.offsetHeight;
        scheduleWrite(() => {
          element.classList.add(classes[`${type}Active`]);
          setTimeout(() => {
            scheduleWrite(() => {
              element.classList.remove(classes[type], classes[`${type}Active`]);
              element.classList.add(classes[`${type}Done`]);
              resolve();
            });
          }, duration);
        });
      });
    });
  });
}

// packages/core/src/a11y.js
var focusedElement = signal(null);
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    focusedElement.set(e.target);
  });
}
function useFocus() {
  return {
    current: () => focusedElement(),
    focus: (element) => element?.focus(),
    blur: () => document.activeElement?.blur()
  };
}
function useFocusRestore() {
  const previousFocusRef = { current: null };
  function capture(target) {
    if (typeof document === "undefined") return;
    previousFocusRef.current = target || document.activeElement || null;
  }
  function restore(fallbackTarget) {
    const target = previousFocusRef.current || fallbackTarget;
    if (target && typeof target.focus === "function") {
      target.focus();
    }
  }
  return {
    capture,
    restore,
    previous: () => previousFocusRef.current
  };
}
function useFocusTrap(containerRef) {
  let previousFocus = null;
  function activate() {
    if (typeof document === "undefined") return;
    previousFocus = document.activeElement;
    const container = containerRef.current || containerRef;
    if (!container || typeof container.querySelectorAll !== "function") return;
    const focusables = getFocusableElements(container);
    if (focusables.length === 0) return;
    focusables[0].focus();
    function handleKeydown(e) {
      if (e.key !== "Tab") return;
      const focusables2 = getFocusableElements(container);
      const first = focusables2[0];
      const last = focusables2[focusables2.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    container.addEventListener("keydown", handleKeydown);
    return () => {
      container.removeEventListener("keydown", handleKeydown);
    };
  }
  function deactivate() {
    if (previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus();
    }
  }
  return { activate, deactivate };
}
function getFocusableElements(container) {
  const selector = [
    "button:not([disabled])",
    "a[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])'
  ].join(",");
  return Array.from(container.querySelectorAll(selector)).filter((el) => {
    return el.offsetParent !== null;
  });
}
function FocusTrap({ children, active = true }) {
  const containerRef = { current: null };
  const refVersion = signal(0);
  const trap = useFocusTrap(containerRef);
  let trapCleanup = null;
  const setRef = (el) => {
    containerRef.current = el;
    refVersion.set((v) => v + 1);
  };
  const dispose = effect(() => {
    refVersion();
    if (trapCleanup) {
      trapCleanup();
      trapCleanup = null;
      trap.deactivate();
    }
    if (active && containerRef.current) {
      trapCleanup = trap.activate();
      return () => {
        trapCleanup?.();
        trapCleanup = null;
        trap.deactivate();
      };
    }
  });
  const ctx = getCurrentComponent?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => {
      dispose();
      trapCleanup?.();
      trapCleanup = null;
      trap.deactivate();
    });
  }
  return h("div", { ref: setRef }, children);
}
var announcer = null;
var announcerId = 0;
function getAnnouncer() {
  if (typeof document === "undefined") return null;
  if (!announcer) {
    announcer = document.createElement("div");
    announcer.id = "what-announcer";
    announcer.setAttribute("aria-live", "polite");
    announcer.setAttribute("aria-atomic", "true");
    announcer.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
    document.body.appendChild(announcer);
  }
  return announcer;
}
function announce(message, options = {}) {
  const { priority = "polite", timeout = 1e3 } = options;
  const announcer2 = getAnnouncer();
  if (!announcer2) return;
  announcer2.setAttribute("aria-live", priority);
  const id = ++announcerId;
  announcer2.textContent = "";
  requestAnimationFrame(() => {
    if (announcerId === id) {
      announcer2.textContent = message;
    }
  });
  setTimeout(() => {
    if (announcerId === id) {
      announcer2.textContent = "";
    }
  }, timeout);
}
function announceAssertive(message) {
  return announce(message, { priority: "assertive" });
}
function SkipLink({ href = "#main", children = "Skip to content" }) {
  return h("a", {
    href,
    class: "what-skip-link",
    onClick: (e) => {
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        target.focus();
        target.scrollIntoView();
      }
    },
    style: {
      position: "absolute",
      top: "-40px",
      left: "0",
      padding: "8px",
      background: "#000",
      color: "#fff",
      textDecoration: "none",
      zIndex: "10000"
    },
    onFocus: (e) => {
      e.target.style.top = "0";
    },
    onBlur: (e) => {
      e.target.style.top = "-40px";
    }
  }, children);
}
function useAriaExpanded(initialExpanded = false) {
  const expanded = signal(initialExpanded);
  return {
    expanded: () => expanded(),
    toggle: () => expanded.set(!expanded.peek()),
    open: () => expanded.set(true),
    close: () => expanded.set(false),
    buttonProps: () => ({
      "aria-expanded": expanded(),
      onClick: () => expanded.set(!expanded.peek())
    }),
    panelProps: () => ({
      hidden: !expanded()
    })
  };
}
function useAriaSelected(initialSelected = null) {
  const selected = signal(initialSelected);
  return {
    selected: () => selected(),
    select: (value) => selected.set(value),
    isSelected: (value) => selected() === value,
    itemProps: (value) => ({
      "aria-selected": selected() === value,
      onClick: () => selected.set(value)
    })
  };
}
function useAriaChecked(initialChecked = false) {
  const checked = signal(initialChecked);
  return {
    checked: () => checked(),
    toggle: () => checked.set(!checked.peek()),
    set: (value) => checked.set(value),
    checkboxProps: () => ({
      role: "checkbox",
      "aria-checked": checked(),
      tabIndex: 0,
      onClick: () => checked.set(!checked.peek()),
      onKeyDown: (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          checked.set(!checked.peek());
        }
      }
    })
  };
}
function useRovingTabIndex(itemCountOrSignal) {
  const getCount = typeof itemCountOrSignal === "function" ? itemCountOrSignal : () => itemCountOrSignal;
  const focusIndex = signal(0);
  function handleKeyDown(e) {
    const count = getCount();
    if (count <= 0) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        focusIndex.set((focusIndex.peek() + 1) % count);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        focusIndex.set((focusIndex.peek() - 1 + count) % count);
        break;
      case "Home":
        e.preventDefault();
        focusIndex.set(0);
        break;
      case "End":
        e.preventDefault();
        focusIndex.set(count - 1);
        break;
    }
  }
  return {
    focusIndex: () => focusIndex(),
    setFocusIndex: (i) => focusIndex.set(i),
    getItemProps: (index) => ({
      tabIndex: focusIndex() === index ? 0 : -1,
      onKeyDown: handleKeyDown,
      onFocus: () => focusIndex.set(index)
    }),
    containerProps: () => ({
      role: "listbox"
    })
  };
}
function VisuallyHidden({ children, as = "span" }) {
  return h(as, {
    style: {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: "0",
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0, 0, 0, 0)",
      whiteSpace: "nowrap",
      border: "0"
    }
  }, children);
}
function LiveRegion({ children, priority = "polite", atomic = true }) {
  return h("div", {
    "aria-live": priority,
    "aria-atomic": atomic
  }, children);
}
var idCounter = 0;
function useId(prefix = "what") {
  const id = `${prefix}-${++idCounter}`;
  return () => id;
}
function useIds(count, prefix = "what") {
  const ids = [];
  for (let i = 0; i < count; i++) {
    ids.push(`${prefix}-${++idCounter}`);
  }
  return ids;
}
function useDescribedBy(description) {
  const id = useId("desc");
  return {
    descriptionId: id,
    descriptionProps: () => ({
      id: id(),
      style: { display: "none" }
    }),
    describedByProps: () => ({
      "aria-describedby": id()
    }),
    Description: () => h("div", {
      id: id(),
      style: { display: "none" }
    }, description)
  };
}
function useLabelledBy(label) {
  const id = useId("label");
  return {
    labelId: id,
    labelProps: () => ({
      id: id()
    }),
    labelledByProps: () => ({
      "aria-labelledby": id()
    })
  };
}
var Keys = {
  Enter: "Enter",
  Space: " ",
  Escape: "Escape",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  Tab: "Tab"
};
function onKey(key, handler) {
  return (e) => {
    if (e.key === key) {
      handler(e);
    }
  };
}
function onKeys(keys, handler) {
  return (e) => {
    if (keys.includes(e.key)) {
      handler(e);
    }
  };
}

// packages/core/src/skeleton.js
var skeletonStyles = `
.what-skeleton {
  background: linear-gradient(
    90deg,
    var(--skeleton-base, #e0e0e0) 0%,
    var(--skeleton-highlight, #f0f0f0) 50%,
    var(--skeleton-base, #e0e0e0) 100%
  );
  background-size: 200% 100%;
  animation: what-skeleton-shimmer 1.5s infinite ease-in-out;
  border-radius: var(--skeleton-radius, 4px);
}

@keyframes what-skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.what-skeleton-pulse {
  animation: what-skeleton-pulse 1.5s infinite ease-in-out;
}

@keyframes what-skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.what-skeleton-wave {
  position: relative;
  overflow: hidden;
}

.what-skeleton-wave::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.4) 50%,
    transparent 100%
  );
  animation: what-skeleton-wave 1.5s infinite;
}

@keyframes what-skeleton-wave {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
`;
var stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style2 = document.createElement("style");
  style2.textContent = skeletonStyles;
  document.head.appendChild(style2);
}
function Skeleton({
  width,
  height,
  variant = "shimmer",
  // 'shimmer' | 'pulse' | 'wave'
  circle = false,
  class: className,
  style: customStyle,
  count = 1
}) {
  injectStyles();
  const baseClass = `what-skeleton ${variant === "pulse" ? "what-skeleton-pulse" : ""} ${variant === "wave" ? "what-skeleton-wave" : ""}`;
  const finalClass = className ? `${baseClass} ${className}` : baseClass;
  const style2 = {
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
    borderRadius: circle ? "50%" : void 0,
    ...customStyle
  };
  if (count === 1) {
    return h("div", { class: finalClass, style: style2, "aria-hidden": "true" });
  }
  return Array.from(
    { length: count },
    (_, i) => h("div", {
      key: i,
      class: finalClass,
      style: { ...style2, marginBottom: i < count - 1 ? "8px" : void 0 },
      "aria-hidden": "true"
    })
  );
}
function SkeletonText({
  lines = 3,
  lastLineWidth = "60%",
  lineHeight = 16,
  gap = 8,
  variant = "shimmer"
}) {
  injectStyles();
  return h(
    "div",
    { class: "what-skeleton-text", "aria-hidden": "true" },
    Array.from(
      { length: lines },
      (_, i) => h("div", {
        key: i,
        class: `what-skeleton ${variant === "pulse" ? "what-skeleton-pulse" : ""}`,
        style: {
          height: `${lineHeight}px`,
          width: i === lines - 1 ? lastLineWidth : "100%",
          marginBottom: i < lines - 1 ? `${gap}px` : void 0
        }
      })
    )
  );
}
function SkeletonAvatar({
  size = 40,
  variant = "shimmer"
}) {
  return Skeleton({
    width: size,
    height: size,
    circle: true,
    variant
  });
}
function SkeletonCard({
  imageHeight = 200,
  lines = 3,
  variant = "shimmer"
}) {
  injectStyles();
  return h(
    "div",
    { class: "what-skeleton-card", "aria-hidden": "true" },
    // Image placeholder
    h("div", {
      class: `what-skeleton ${variant === "pulse" ? "what-skeleton-pulse" : ""}`,
      style: { height: `${imageHeight}px`, width: "100%", marginBottom: "16px" }
    }),
    // Title
    h("div", {
      class: `what-skeleton ${variant === "pulse" ? "what-skeleton-pulse" : ""}`,
      style: { height: "24px", width: "70%", marginBottom: "12px" }
    }),
    // Text lines
    SkeletonText({ lines, variant })
  );
}
function SkeletonTable({
  rows = 5,
  columns = 4,
  variant = "shimmer"
}) {
  injectStyles();
  return h(
    "div",
    { class: "what-skeleton-table", "aria-hidden": "true" },
    // Header
    h(
      "div",
      { style: { display: "flex", gap: "16px", marginBottom: "16px" } },
      Array.from(
        { length: columns },
        (_, i) => h("div", {
          key: i,
          class: `what-skeleton ${variant === "pulse" ? "what-skeleton-pulse" : ""}`,
          style: { height: "20px", flex: 1 }
        })
      )
    ),
    // Rows
    Array.from(
      { length: rows },
      (_, rowIndex) => h(
        "div",
        {
          key: rowIndex,
          style: {
            display: "flex",
            gap: "16px",
            marginBottom: rowIndex < rows - 1 ? "12px" : void 0
          }
        },
        Array.from(
          { length: columns },
          (_2, colIndex) => h("div", {
            key: colIndex,
            class: `what-skeleton ${variant === "pulse" ? "what-skeleton-pulse" : ""}`,
            style: { height: "16px", flex: 1 }
          })
        )
      )
    )
  );
}
function IslandSkeleton({
  type = "default",
  // 'default' | 'card' | 'text' | 'custom'
  height,
  children
}) {
  injectStyles();
  if (type === "card") {
    return SkeletonCard({});
  }
  if (type === "text") {
    return SkeletonText({});
  }
  if (children) {
    return children;
  }
  return h("div", {
    class: "what-skeleton what-island-skeleton",
    style: {
      height: typeof height === "number" ? `${height}px` : height || "100px",
      width: "100%"
    },
    "aria-hidden": "true"
  });
}
function useSkeleton(asyncFn, deps = []) {
  const isLoading = signal(true);
  const data = signal(null);
  const error = signal(null);
  effect(() => {
    isLoading.set(true);
    error.set(null);
    Promise.resolve(asyncFn()).then((result) => {
      data.set(result);
      isLoading.set(false);
    }).catch((err) => {
      error.set(err);
      isLoading.set(false);
    });
  });
  return {
    isLoading: () => isLoading(),
    data: () => data(),
    error: () => error(),
    Skeleton: (props) => isLoading() ? Skeleton(props) : null
  };
}
function Placeholder({
  width = "100%",
  height = 100,
  label = "Loading...",
  showLabel = false,
  variant = "shimmer"
}) {
  injectStyles();
  return h(
    "div",
    {
      class: `what-skeleton ${variant === "pulse" ? "what-skeleton-pulse" : ""}`,
      style: {
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      },
      "aria-label": label,
      role: "status"
    },
    showLabel && h("span", {
      style: {
        color: "var(--skeleton-text, #999)",
        fontSize: "14px"
      }
    }, label)
  );
}
function LoadingDots({ size = 8, color = "#666" }) {
  injectStyles();
  const dotStyle = {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "50%",
    backgroundColor: color,
    animation: "what-skeleton-pulse 1s infinite ease-in-out"
  };
  return h(
    "div",
    {
      class: "what-loading-dots",
      style: { display: "flex", gap: `${size / 2}px` },
      "aria-label": "Loading",
      role: "status"
    },
    h("div", { style: { ...dotStyle, animationDelay: "0s" } }),
    h("div", { style: { ...dotStyle, animationDelay: "0.2s" } }),
    h("div", { style: { ...dotStyle, animationDelay: "0.4s" } })
  );
}
function Spinner({ size = 24, color = "#666", strokeWidth = 2 }) {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      style: { animation: "spin 1s linear infinite" },
      "aria-label": "Loading",
      role: "status"
    },
    h("style", null, "@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }"),
    h("circle", {
      cx: 12,
      cy: 12,
      r: 10,
      stroke: color,
      strokeWidth,
      fill: "none",
      strokeDasharray: "31.4 31.4",
      strokeLinecap: "round"
    })
  );
}

// packages/core/src/data.js
var cacheSignals = /* @__PURE__ */ new Map();
var errorSignals = /* @__PURE__ */ new Map();
var validatingSignals = /* @__PURE__ */ new Map();
var cacheTimestamps = /* @__PURE__ */ new Map();
var MAX_CACHE_SIZE = 200;
function getCacheSignal(key) {
  cacheTimestamps.set(key, Date.now());
  if (!cacheSignals.has(key)) {
    cacheSignals.set(key, signal(null));
    if (cacheSignals.size > MAX_CACHE_SIZE) {
      evictOldest();
    }
  }
  return cacheSignals.get(key);
}
function getErrorSignal(key) {
  if (!errorSignals.has(key)) errorSignals.set(key, signal(null));
  return errorSignals.get(key);
}
function getValidatingSignal(key) {
  if (!validatingSignals.has(key)) validatingSignals.set(key, signal(false));
  return validatingSignals.get(key);
}
function evictOldest() {
  const entries = [...cacheTimestamps.entries()].sort((a, b) => a[1] - b[1]);
  const toRemove = Math.floor(MAX_CACHE_SIZE * 0.2);
  for (let i = 0; i < toRemove && i < entries.length; i++) {
    const key = entries[i][0];
    if (revalidationSubscribers.has(key) && revalidationSubscribers.get(key).size > 0) continue;
    cacheSignals.delete(key);
    errorSignals.delete(key);
    validatingSignals.delete(key);
    cacheTimestamps.delete(key);
    lastFetchTimestamps.delete(key);
  }
}
var revalidationSubscribers = /* @__PURE__ */ new Map();
function subscribeToKey(key, revalidateFn) {
  if (!revalidationSubscribers.has(key)) revalidationSubscribers.set(key, /* @__PURE__ */ new Set());
  revalidationSubscribers.get(key).add(revalidateFn);
  return () => {
    const subs = revalidationSubscribers.get(key);
    if (subs) {
      subs.delete(revalidateFn);
      if (subs.size === 0) revalidationSubscribers.delete(key);
    }
  };
}
var inFlightRequests = /* @__PURE__ */ new Map();
var lastFetchTimestamps = /* @__PURE__ */ new Map();
function scopedEffect2(fn) {
  const ctx = getCurrentComponent?.();
  const dispose = effect(fn);
  if (ctx) ctx.effects.push(dispose);
  return dispose;
}
function useFetch(url, options = {}) {
  const {
    method = "GET",
    body,
    headers = {},
    transform = (data2) => data2,
    initialData = null
  } = options;
  const data = signal(initialData);
  const error = signal(null);
  const isLoading = signal(true);
  let abortController = null;
  async function fetchData() {
    if (abortController) abortController.abort();
    abortController = new AbortController();
    const { signal: abortSignal } = abortController;
    isLoading.set(true);
    error.set(null);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers
        },
        body: body ? JSON.stringify(body) : void 0,
        signal: abortSignal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const json = await response.json();
      if (!abortSignal.aborted) {
        data.set(transform(json));
      }
    } catch (e) {
      if (!abortSignal.aborted) {
        error.set(e);
      }
    } finally {
      if (!abortSignal.aborted) {
        isLoading.set(false);
      }
    }
  }
  scopedEffect2(() => {
    fetchData();
    return () => {
      if (abortController) abortController.abort();
    };
  });
  return {
    data: () => data(),
    error: () => error(),
    isLoading: () => isLoading(),
    refetch: fetchData,
    mutate: (newData) => data.set(newData)
  };
}
function useSWR(key, fetcher, options = {}) {
  const {
    revalidateOnFocus = true,
    revalidateOnReconnect = true,
    refreshInterval = 0,
    dedupingInterval = 2e3,
    fallbackData,
    onSuccess,
    onError,
    suspense = false
  } = options;
  if (key == null || key === false) {
    const data2 = signal(fallbackData || null);
    const error2 = signal(null);
    return {
      data: () => data2(),
      error: () => error2(),
      isLoading: () => false,
      isValidating: () => false,
      mutate: (newData) => data2.set(typeof newData === "function" ? newData(data2()) : newData),
      revalidate: () => Promise.resolve()
    };
  }
  const cacheS = getCacheSignal(key);
  const error = getErrorSignal(key);
  const isValidating = getValidatingSignal(key);
  const data = computed(() => cacheS() ?? fallbackData ?? null);
  const isLoading = computed(() => cacheS() == null && isValidating());
  let abortController = null;
  async function revalidate() {
    const now = Date.now();
    if (inFlightRequests.has(key)) {
      const existing = inFlightRequests.get(key);
      if (now - existing.timestamp < dedupingInterval) {
        existing.refCount++;
        return existing.promise;
      }
    }
    const lastFetch = lastFetchTimestamps.get(key);
    if (lastFetch && now - lastFetch < dedupingInterval && cacheS.peek() != null) {
      return cacheS.peek();
    }
    if (abortController) {
      const existing = inFlightRequests.get(key);
      if (!existing || existing.refCount <= 1) {
        abortController.abort();
      }
    }
    abortController = new AbortController();
    const { signal: abortSignal } = abortController;
    isValidating.set(true);
    const promise = fetcher(key, { signal: abortSignal });
    inFlightRequests.set(key, { promise, timestamp: now, refCount: 1 });
    try {
      const result = await promise;
      if (abortSignal.aborted) return;
      batch(() => {
        cacheS.set(result);
        error.set(null);
      });
      cacheTimestamps.set(key, Date.now());
      lastFetchTimestamps.set(key, Date.now());
      if (onSuccess) onSuccess(result, key);
      return result;
    } catch (e) {
      if (abortSignal.aborted) return;
      error.set(e);
      if (onError) onError(e, key);
      throw e;
    } finally {
      if (!abortSignal.aborted) isValidating.set(false);
      const flight = inFlightRequests.get(key);
      if (flight) {
        flight.refCount--;
        if (flight.refCount <= 0) inFlightRequests.delete(key);
      }
    }
  }
  const unsubscribe = subscribeToKey(key, () => revalidate().catch(() => {
  }));
  scopedEffect2(() => {
    revalidate().catch(() => {
    });
    return () => {
      if (abortController) abortController.abort();
      unsubscribe();
    };
  });
  if (revalidateOnFocus && typeof window !== "undefined") {
    scopedEffect2(() => {
      const handler = () => {
        if (document.visibilityState === "visible") {
          revalidate().catch(() => {
          });
        }
      };
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    });
  }
  if (revalidateOnReconnect && typeof window !== "undefined") {
    scopedEffect2(() => {
      const handler = () => revalidate().catch(() => {
      });
      window.addEventListener("online", handler);
      return () => window.removeEventListener("online", handler);
    });
  }
  if (refreshInterval > 0) {
    scopedEffect2(() => {
      const interval = setInterval(() => {
        revalidate().catch(() => {
        });
      }, refreshInterval);
      return () => clearInterval(interval);
    });
  }
  return {
    data: () => data(),
    error: () => error(),
    isLoading: () => isLoading(),
    isValidating: () => isValidating(),
    mutate: (newData, shouldRevalidate = true) => {
      const resolved = typeof newData === "function" ? newData(cacheS.peek()) : newData;
      cacheS.set(resolved);
      cacheTimestamps.set(key, Date.now());
      if (shouldRevalidate) {
        revalidate().catch(() => {
        });
      }
    },
    revalidate
  };
}
function useQuery(options) {
  const {
    queryKey,
    queryFn,
    enabled = true,
    staleTime = 0,
    cacheTime = 5 * 60 * 1e3,
    refetchOnWindowFocus = true,
    refetchInterval = false,
    retry = 3,
    retryDelay = (attempt) => Math.min(1e3 * 2 ** attempt, 3e4),
    onSuccess,
    onError,
    onSettled,
    select,
    placeholderData
  } = options;
  const key = Array.isArray(queryKey) ? queryKey.join(":") : queryKey;
  const cacheS = getCacheSignal(key);
  const data = computed(() => {
    const d = cacheS();
    return select && d !== null ? select(d) : d;
  });
  const error = getErrorSignal(key);
  const status = signal(cacheS.peek() != null ? "success" : "loading");
  const fetchStatus = signal("idle");
  let lastFetchTime = 0;
  let abortController = null;
  async function fetchQuery() {
    if (!enabled) return;
    const now = Date.now();
    if (cacheS.peek() != null && now - lastFetchTime < staleTime) {
      return cacheS.peek();
    }
    if (abortController) abortController.abort();
    abortController = new AbortController();
    const { signal: abortSignal } = abortController;
    fetchStatus.set("fetching");
    if (cacheS.peek() == null) {
      status.set("loading");
    }
    let attempts = 0;
    async function attemptFetch() {
      try {
        const result = await queryFn({ queryKey: Array.isArray(queryKey) ? queryKey : [queryKey], signal: abortSignal });
        if (abortSignal.aborted) return;
        batch(() => {
          cacheS.set(result);
          error.set(null);
          status.set("success");
          fetchStatus.set("idle");
        });
        lastFetchTime = Date.now();
        cacheTimestamps.set(key, Date.now());
        if (onSuccess) onSuccess(result);
        if (onSettled) onSettled(result, null);
        setTimeout(() => {
          if (Date.now() - lastFetchTime >= cacheTime) {
            const subs = revalidationSubscribers.get(key);
            if (!subs || subs.size === 0) {
              cacheSignals.delete(key);
              errorSignals.delete(key);
              validatingSignals.delete(key);
              cacheTimestamps.delete(key);
              lastFetchTimestamps.delete(key);
            }
          }
        }, cacheTime);
        return result;
      } catch (e) {
        if (abortSignal.aborted) return;
        attempts++;
        if (attempts < retry) {
          await new Promise((resolve, reject) => {
            const id = setTimeout(resolve, retryDelay(attempts));
            abortSignal.addEventListener("abort", () => {
              clearTimeout(id);
              reject(new DOMException("Aborted", "AbortError"));
            }, { once: true });
          }).catch((e2) => {
            if (e2.name === "AbortError") return;
            throw e2;
          });
          if (abortSignal.aborted) return;
          return attemptFetch();
        }
        batch(() => {
          error.set(e);
          status.set("error");
          fetchStatus.set("idle");
        });
        if (onError) onError(e);
        if (onSettled) onSettled(null, e);
        throw e;
      }
    }
    return attemptFetch();
  }
  const unsubscribe = subscribeToKey(key, () => fetchQuery().catch(() => {
  }));
  scopedEffect2(() => {
    if (enabled) {
      fetchQuery().catch(() => {
      });
    }
    return () => {
      if (abortController) abortController.abort();
      unsubscribe();
    };
  });
  if (refetchOnWindowFocus && typeof window !== "undefined") {
    scopedEffect2(() => {
      const handler = () => {
        if (document.visibilityState === "visible") {
          fetchQuery().catch(() => {
          });
        }
      };
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    });
  }
  if (refetchInterval) {
    scopedEffect2(() => {
      const interval = setInterval(() => {
        fetchQuery().catch(() => {
        });
      }, refetchInterval);
      return () => clearInterval(interval);
    });
  }
  return {
    data: () => data() ?? placeholderData,
    error: () => error(),
    status: () => status(),
    fetchStatus: () => fetchStatus(),
    isLoading: () => status() === "loading",
    isError: () => status() === "error",
    isSuccess: () => status() === "success",
    isFetching: () => fetchStatus() === "fetching",
    refetch: fetchQuery
  };
}
function useInfiniteQuery(options) {
  const {
    queryKey,
    queryFn,
    getNextPageParam,
    getPreviousPageParam,
    initialPageParam,
    ...rest
  } = options;
  const pages = signal([]);
  const pageParams = signal([initialPageParam]);
  const hasNextPage = signal(true);
  const hasPreviousPage = signal(false);
  const isFetchingNextPage = signal(false);
  const isFetchingPreviousPage = signal(false);
  const key = Array.isArray(queryKey) ? queryKey.join(":") : queryKey;
  let abortController = null;
  let isRefetching = false;
  async function fetchPage(pageParam, direction = "next") {
    if (abortController) abortController.abort();
    abortController = new AbortController();
    const { signal: abortSignal } = abortController;
    const loading = direction === "next" ? isFetchingNextPage : isFetchingPreviousPage;
    loading.set(true);
    try {
      const result = await queryFn({
        queryKey: Array.isArray(queryKey) ? queryKey : [queryKey],
        pageParam,
        signal: abortSignal
      });
      if (abortSignal.aborted) return;
      batch(() => {
        if (isRefetching) {
          pages.set([result]);
          pageParams.set([pageParam]);
          isRefetching = false;
        } else if (direction === "next") {
          pages.set([...pages.peek(), result]);
          pageParams.set([...pageParams.peek(), pageParam]);
        } else {
          pages.set([result, ...pages.peek()]);
          pageParams.set([pageParam, ...pageParams.peek()]);
        }
        const nextParam = getNextPageParam?.(result, pages.peek());
        hasNextPage.set(nextParam !== void 0);
        if (getPreviousPageParam) {
          const prevParam = getPreviousPageParam(result, pages.peek());
          hasPreviousPage.set(prevParam !== void 0);
        }
      });
      return result;
    } finally {
      if (!abortSignal.aborted) loading.set(false);
    }
  }
  scopedEffect2(() => {
    fetchPage(initialPageParam).catch(() => {
    });
    return () => {
      if (abortController) abortController.abort();
    };
  });
  return {
    data: () => ({ pages: pages(), pageParams: pageParams() }),
    hasNextPage: () => hasNextPage(),
    hasPreviousPage: () => hasPreviousPage(),
    isFetchingNextPage: () => isFetchingNextPage(),
    isFetchingPreviousPage: () => isFetchingPreviousPage(),
    fetchNextPage: async () => {
      const lastPage = pages.peek()[pages.peek().length - 1];
      const nextParam = getNextPageParam?.(lastPage, pages.peek());
      if (nextParam !== void 0) {
        return fetchPage(nextParam, "next");
      }
    },
    fetchPreviousPage: async () => {
      const firstPage = pages.peek()[0];
      const prevParam = getPreviousPageParam?.(firstPage, pages.peek());
      if (prevParam !== void 0) {
        return fetchPage(prevParam, "previous");
      }
    },
    refetch: async () => {
      isRefetching = true;
      return fetchPage(initialPageParam);
    }
  };
}
function invalidateQueries(keyOrPredicate, options = {}) {
  const { hard = false } = options;
  const keysToInvalidate = [];
  if (typeof keyOrPredicate === "function") {
    for (const [key] of cacheSignals) {
      if (keyOrPredicate(key)) keysToInvalidate.push(key);
    }
  } else {
    keysToInvalidate.push(keyOrPredicate);
  }
  for (const key of keysToInvalidate) {
    if (hard && cacheSignals.has(key)) cacheSignals.get(key).set(null);
    const subs = revalidationSubscribers.get(key);
    if (subs) {
      for (const revalidate of subs) revalidate();
    }
  }
}
function prefetchQuery(key, fetcher) {
  const cacheS = getCacheSignal(key);
  return fetcher(key).then((result) => {
    cacheS.set(result);
    cacheTimestamps.set(key, Date.now());
    return result;
  });
}
function setQueryData(key, updater) {
  const cacheS = getCacheSignal(key);
  const current = cacheS.peek();
  cacheS.set(typeof updater === "function" ? updater(current) : updater);
  cacheTimestamps.set(key, Date.now());
}
function getQueryData(key) {
  return cacheSignals.has(key) ? cacheSignals.get(key).peek() : void 0;
}
function clearCache() {
  cacheSignals.clear();
  errorSignals.clear();
  validatingSignals.clear();
  cacheTimestamps.clear();
  lastFetchTimestamps.clear();
  inFlightRequests.clear();
}
function __getCacheSnapshot() {
  const entries = [];
  for (const [key, sig] of cacheSignals) {
    entries.push({
      key,
      data: sig.peek(),
      error: errorSignals.has(key) ? errorSignals.get(key).peek() : null,
      isValidating: validatingSignals.has(key) ? validatingSignals.get(key).peek() : false
    });
  }
  return entries;
}

// packages/core/src/form.js
function useForm(options = {}) {
  const ctx = getCurrentComponent?.();
  if (ctx) {
    const index = ctx.hookIndex++;
    if (!ctx.hooks[index]) {
      ctx.hooks[index] = createFormController(options);
    }
    return ctx.hooks[index];
  }
  return createFormController(options);
}
function createFormController(options = {}) {
  const {
    defaultValues = {},
    mode = "onSubmit",
    // 'onSubmit' | 'onChange' | 'onBlur'
    reValidateMode = "onChange",
    resolver
  } = options;
  const fieldSignals = {};
  const errorSignals2 = {};
  const touchedSignals = {};
  const errorsState = signal({});
  function getFieldSignal(name) {
    if (!fieldSignals[name]) {
      fieldSignals[name] = signal(defaultValues[name] ?? "");
    }
    return fieldSignals[name];
  }
  function getErrorSignal2(name) {
    if (!errorSignals2[name]) {
      errorSignals2[name] = signal(null);
    }
    return errorSignals2[name];
  }
  function getTouchedSignal(name) {
    if (!touchedSignals[name]) {
      touchedSignals[name] = signal(false);
    }
    return touchedSignals[name];
  }
  const isDirty = signal(false);
  const isSubmitting = signal(false);
  const isSubmitted = signal(false);
  const isValidating = signal(false);
  const submitCount = signal(0);
  function getAllValues(tracked = false) {
    const result = { ...defaultValues };
    for (const [name, sig] of Object.entries(fieldSignals)) {
      result[name] = tracked ? sig() : sig.peek();
    }
    return result;
  }
  function getAllErrors(tracked = false) {
    return tracked ? errorsState() : errorsState.peek();
  }
  function setFieldError(name, error) {
    const nextError = error ?? null;
    getErrorSignal2(name).set(nextError);
    errorsState.set((prev) => {
      const prevError = prev[name];
      if (prevError === nextError) return prev;
      if (nextError == null) {
        if (!Object.prototype.hasOwnProperty.call(prev, name)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return { ...prev, [name]: nextError };
    });
  }
  function replaceAllErrors(nextErrors = {}) {
    const normalized = nextErrors || {};
    batch(() => {
      for (const [name, sig] of Object.entries(errorSignals2)) {
        if (!Object.prototype.hasOwnProperty.call(normalized, name)) {
          sig.set(null);
        }
      }
      for (const [name, err] of Object.entries(normalized)) {
        getErrorSignal2(name).set(err ?? null);
      }
      errorsState.set({ ...normalized });
    });
  }
  const isValid = computed(() => Object.keys(getAllErrors(true)).length === 0);
  const dirtyFields = computed(() => {
    const dirty = {};
    for (const [name, sig] of Object.entries(fieldSignals)) {
      if (sig() !== (defaultValues[name] ?? "")) {
        dirty[name] = true;
      }
    }
    return dirty;
  });
  async function validate(fieldName) {
    if (!resolver) return true;
    isValidating.set(true);
    try {
      const result = await resolver(getAllValues(false));
      const nextErrors = result?.errors || {};
      if (fieldName) {
        const nextError = nextErrors[fieldName] ?? null;
        setFieldError(fieldName, nextError);
        return !nextError;
      } else {
        replaceAllErrors(nextErrors);
        return Object.keys(nextErrors).length === 0;
      }
    } finally {
      isValidating.set(false);
    }
  }
  function register(name, options2 = {}) {
    const fieldSig = getFieldSignal(name);
    const isCheckbox = options2.type === "checkbox" || options2.type === "radio";
    const handler = (e) => {
      const value = e.target.type === "checkbox" || e.target.type === "radio" ? e.target.checked : e.target.value;
      setValue(name, value);
      if (mode === "onChange" || isSubmitted.peek() && reValidateMode === "onChange") {
        validate(name);
      }
    };
    const result = {
      name,
      onBlur: () => {
        getTouchedSignal(name).set(true);
        if (mode === "onBlur" || isSubmitted.peek() && reValidateMode === "onBlur") {
          validate(name);
        }
      },
      onFocus: () => {
      },
      ref: options2.ref
    };
    if (isCheckbox) {
      Object.defineProperty(result, "checked", {
        get() {
          return !!fieldSig();
        },
        enumerable: true
      });
      result.onchange = handler;
    } else {
      Object.defineProperty(result, "value", {
        get() {
          return fieldSig();
        },
        enumerable: true
      });
      result.oninput = handler;
    }
    return result;
  }
  function setValue(name, value, options2 = {}) {
    const { shouldValidate = false, shouldDirty = true } = options2;
    getFieldSignal(name).set(value);
    if (shouldDirty) isDirty.set(true);
    if (shouldValidate) {
      validate(name);
    }
  }
  function getValue(name) {
    return getFieldSignal(name)();
  }
  function setError(name, error) {
    setFieldError(name, error);
  }
  function clearError(name) {
    setFieldError(name, null);
  }
  function clearErrors() {
    replaceAllErrors({});
  }
  function reset(newValues = defaultValues) {
    batch(() => {
      for (const [name, sig] of Object.entries(fieldSignals)) {
        sig.set(newValues[name] ?? "");
      }
      for (const sig of Object.values(errorSignals2)) {
        sig.set(null);
      }
      errorsState.set({});
      for (const sig of Object.values(touchedSignals)) {
        sig.set(false);
      }
      isDirty.set(false);
      isSubmitted.set(false);
    });
  }
  function handleSubmit(onValid, onInvalid) {
    return async (e) => {
      if (e) e.preventDefault();
      isSubmitting.set(true);
      isSubmitted.set(true);
      submitCount.set(submitCount.peek() + 1);
      const isFormValid = await validate();
      if (isFormValid) {
        await onValid(getAllValues());
      } else if (onInvalid) {
        onInvalid(getAllErrors(false));
      }
      isSubmitting.set(false);
    };
  }
  function watch(name) {
    if (name) {
      return computed(() => getFieldSignal(name)());
    }
    return computed(() => getAllValues(true));
  }
  return {
    register,
    handleSubmit,
    setValue,
    getValue,
    setError,
    clearError,
    clearErrors,
    reset,
    watch,
    validate,
    // Form state
    formState: {
      get values() {
        return getAllValues(true);
      },
      get errors() {
        return getAllErrors(true);
      },
      error: (name) => getErrorSignal2(name)(),
      get touched() {
        const result = {};
        for (const [name, sig] of Object.entries(touchedSignals)) {
          if (sig()) result[name] = true;
        }
        return result;
      },
      isDirty: () => isDirty(),
      isValid,
      isValidating: () => isValidating(),
      isSubmitting: () => isSubmitting(),
      isSubmitted: () => isSubmitted(),
      submitCount: () => submitCount(),
      dirtyFields
    }
  };
}
function zodResolver(schema) {
  return async (values) => {
    try {
      const result = await schema.parseAsync(values);
      return { values: result, errors: {} };
    } catch (e) {
      const errors = {};
      for (const issue of e.errors || []) {
        const path = issue.path.join(".");
        if (!errors[path]) {
          errors[path] = { type: issue.code, message: issue.message };
        }
      }
      return { values: {}, errors };
    }
  };
}
function yupResolver(schema) {
  return async (values) => {
    try {
      const result = await schema.validate(values, { abortEarly: false });
      return { values: result, errors: {} };
    } catch (e) {
      const errors = {};
      for (const err of e.inner || []) {
        if (!errors[err.path]) {
          errors[err.path] = { type: err.type, message: err.message };
        }
      }
      return { values: {}, errors };
    }
  };
}
function simpleResolver(rules2) {
  return async (values) => {
    const errors = {};
    for (const [field, fieldRules] of Object.entries(rules2)) {
      const value = values[field];
      for (const rule of fieldRules) {
        const error = rule(value, values);
        if (error) {
          errors[field] = { type: "validation", message: error };
          break;
        }
      }
    }
    return { values, errors };
  };
}
var rules = {
  required: (message = "This field is required") => (value) => {
    if (value === void 0 || value === null || value === "") {
      return message;
    }
  },
  minLength: (min, message) => (value) => {
    if (typeof value === "string" && value.length < min) {
      return message || `Must be at least ${min} characters`;
    }
  },
  maxLength: (max, message) => (value) => {
    if (typeof value === "string" && value.length > max) {
      return message || `Must be at most ${max} characters`;
    }
  },
  min: (min, message) => (value) => {
    if (typeof value === "number" && value < min) {
      return message || `Must be at least ${min}`;
    }
  },
  max: (max, message) => (value) => {
    if (typeof value === "number" && value > max) {
      return message || `Must be at most ${max}`;
    }
  },
  pattern: (regex, message = "Invalid format") => (value) => {
    if (typeof value === "string" && !regex.test(value)) {
      return message;
    }
  },
  email: (message = "Invalid email address") => (value) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (typeof value === "string" && !emailRegex.test(value)) {
      return message;
    }
  },
  url: (message = "Invalid URL") => (value) => {
    try {
      if (typeof value === "string" && value) {
        new URL(value);
      }
    } catch {
      return message;
    }
  },
  match: (field, message) => (value, values) => {
    if (value !== values[field]) {
      return message || `Must match ${field}`;
    }
  },
  custom: (validator) => validator
};
function useField(name, options = {}) {
  const { validate: validateFn, defaultValue = "" } = options;
  const value = signal(defaultValue);
  const error = signal(null);
  const isTouched = signal(false);
  const isDirty = signal(false);
  async function validate() {
    if (!validateFn) return true;
    const result = await validateFn(value.peek());
    error.set(result || null);
    return !result;
  }
  return {
    name,
    value: () => value(),
    error: () => error(),
    isTouched: () => isTouched(),
    isDirty: () => isDirty(),
    setValue: (v) => {
      value.set(v);
      isDirty.set(true);
    },
    setError: (e) => error.set(e),
    validate,
    reset: () => {
      value.set(defaultValue);
      error.set(null);
      isTouched.set(false);
      isDirty.set(false);
    },
    inputProps: () => ({
      name,
      value: value(),
      onInput: (e) => {
        value.set(e.target.value);
        isDirty.set(true);
      },
      onBlur: () => {
        isTouched.set(true);
        validate();
      }
    })
  };
}
function Input(props) {
  const { register, error, ...rest } = props;
  const registered = register ? register(props.name) : {};
  return h("input", {
    ...rest,
    ...registered,
    "aria-invalid": error ? "true" : void 0
  });
}
function Textarea(props) {
  const { register, error, ...rest } = props;
  const registered = register ? register(props.name) : {};
  return h("textarea", {
    ...rest,
    ...registered,
    "aria-invalid": error ? "true" : void 0
  });
}
function Select(props) {
  const { register, error, children, ...rest } = props;
  const registered = register ? register(props.name) : {};
  return h("select", {
    ...rest,
    ...registered,
    "aria-invalid": error ? "true" : void 0
  }, children);
}
function Checkbox(props) {
  const { register, ...rest } = props;
  const registered = register ? register(props.name) : {};
  return h("input", {
    type: "checkbox",
    ...rest,
    ...registered,
    checked: registered.value
  });
}
function Radio(props) {
  const { register, value: radioValue, ...rest } = props;
  const registered = register ? register(props.name) : {};
  return h("input", {
    type: "radio",
    value: radioValue,
    ...rest,
    checked: registered.value === radioValue,
    onChange: (e) => {
      if (e.target.checked && registered.onInput) {
        registered.onInput({ target: { value: radioValue } });
      }
    }
  });
}
function ErrorMessage({ name, formState, errors, render }) {
  const error = formState && typeof formState.error === "function" ? formState.error(name) : (formState?.errors != null ? formState.errors : typeof errors === "function" ? errors() : errors)?.[name] || null;
  if (!error) return null;
  if (render) {
    return render({ message: error.message, type: error.type });
  }
  return h("span", { class: "what-error", role: "alert" }, error.message);
}

// packages/core/src/errors.js
var ERROR_CODES = {
  INFINITE_EFFECT: {
    code: "ERR_INFINITE_EFFECT",
    severity: "error",
    template: 'Effect "{{effectName}}" exceeded 25 flush iterations \u2014 likely an infinite loop.',
    suggestion: "An effect is writing to a signal it also reads, creating a cycle. Use untrack() to read the signal without subscribing, or restructure so the write and read are in separate effects.",
    codeExample: `// Bad \u2014 reads and writes count, creating a cycle:
effect(() => { count(count() + 1); });

// Good \u2014 use untrack() so the read doesn't subscribe:
effect(() => { count(untrack(count) + 1); });

// Better \u2014 split into separate logic:
const doubled = computed(() => count() * 2);`
  },
  MISSING_SIGNAL_READ: {
    code: "ERR_MISSING_SIGNAL_READ",
    severity: "warning",
    template: 'Signal "{{signalName}}" used without calling () \u2014 renders as "[Function]" instead of its value.',
    suggestion: "Signals are functions. Call them to read: count() not count. In JSX: {count()} not {count}.",
    codeExample: `// Bad \u2014 signal reference, not value:
<span>{count}</span>       // renders "[Function]"

// Good \u2014 call the signal:
<span>{count()}</span>     // renders the actual value`
  },
  HYDRATION_MISMATCH: {
    code: "ERR_HYDRATION_MISMATCH",
    severity: "error",
    template: 'Hydration mismatch in component "{{component}}": server rendered "{{serverHTML}}" but client expects "{{clientHTML}}".',
    suggestion: "Ensure server and client render identical initial HTML. Avoid reading browser-only APIs (window, localStorage) during the initial render. Use onMount() for client-only logic.",
    codeExample: `// Bad \u2014 different on server vs client:
function App() {
  return <p>{window.innerWidth}</p>;
}

// Good \u2014 use onMount for client-only values:
function App() {
  const width = signal(0);
  onMount(() => width(window.innerWidth));
  return <p>{width()}</p>;
}`
  },
  ORPHAN_EFFECT: {
    code: "ERR_ORPHAN_EFFECT",
    severity: "warning",
    template: 'Effect "{{effectName}}" was created outside a reactive root \u2014 it will never be cleaned up.',
    suggestion: "Wrap effect creation in createRoot() or create effects inside component functions where they are automatically tracked.",
    codeExample: `// Bad \u2014 orphaned, leaks memory:
effect(() => console.log(count()));

// Good \u2014 inside a root with cleanup:
createRoot(dispose => {
  effect(() => console.log(count()));
  // later: dispose() cleans up
});`
  },
  SIGNAL_WRITE_IN_RENDER: {
    code: "ERR_SIGNAL_WRITE_IN_RENDER",
    severity: "error",
    template: 'Signal "{{signalName}}" written during render of component "{{component}}". This triggers re-execution.',
    suggestion: "Move signal writes into event handlers, effects, or onMount(). The component body should only read signals, not write them.",
    codeExample: `// Bad \u2014 write during render:
function Counter() {
  count(count() + 1);  // triggers infinite loop
  return <span>{count()}</span>;
}

// Good \u2014 write in event handler:
function Counter() {
  return <button onclick={() => count(c => c + 1)}>{count()}</button>;
}`
  },
  MISSING_CLEANUP: {
    code: "ERR_MISSING_CLEANUP",
    severity: "warning",
    template: 'Effect sets up "{{resource}}" but does not return a cleanup function.',
    suggestion: "Effects that add event listeners, set timers, or open connections should return a cleanup function to prevent memory leaks.",
    codeExample: `// Bad \u2014 no cleanup:
effect(() => {
  window.addEventListener('resize', handler);
});

// Good \u2014 return cleanup:
effect(() => {
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
});`
  },
  UNSAFE_INNERHTML: {
    code: "ERR_UNSAFE_INNERHTML",
    severity: "warning",
    template: "innerHTML set on element without using the __html safety marker.",
    suggestion: "Use the html tagged template literal or pass { __html: content } to mark innerHTML as intentional and reviewed.",
    codeExample: `// Bad \u2014 raw innerHTML (XSS risk):
<div innerHTML={userInput} />

// Good \u2014 explicit opt-in:
<div innerHTML={{ __html: sanitizedContent }} />

// Better \u2014 use the html template literal:
html\`<div>\${sanitizedContent}</div>\``
  },
  MISSING_KEY: {
    code: "ERR_MISSING_KEY",
    severity: "warning",
    template: 'List rendered without key prop in component "{{component}}". Items may re-order incorrectly.',
    suggestion: "Add a unique key prop to each item in a list. Use a stable identifier (like an ID), not the array index.",
    codeExample: `// Bad \u2014 no key:
<For each={items()}>{item => <li>{item.name}</li>}</For>

// Good \u2014 stable key:
<For each={items()}>{item => <li key={item.id}>{item.name}</li>}</For>`
  }
};
var WhatError = class extends Error {
  constructor({ code, message, suggestion, file, line, component, signal: signal2, effect: effect2 }) {
    super(message);
    this.name = "WhatError";
    this.code = code;
    this.suggestion = suggestion;
    this.file = file;
    this.line = line;
    this.component = component;
    this.signal = signal2;
    this.effect = effect2;
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      suggestion: this.suggestion,
      file: this.file,
      line: this.line,
      component: this.component,
      signal: this.signal,
      effect: this.effect
    };
  }
};
function createWhatError(errorCode, context = {}) {
  const def = typeof errorCode === "string" ? ERROR_CODES[errorCode] : errorCode;
  if (!def) {
    return new WhatError({
      code: "ERR_UNKNOWN",
      message: `Unknown error: ${errorCode}`,
      suggestion: "Check the error code and try again."
    });
  }
  let message = def.template;
  for (const [key, val] of Object.entries(context)) {
    message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(val));
  }
  message = message.replace(/\{\{[^}]+\}\}/g, "(unknown)");
  return new WhatError({
    code: def.code,
    message,
    suggestion: def.suggestion,
    file: context.file,
    line: context.line,
    component: context.component,
    signal: context.signal || context.signalName,
    effect: context.effect || context.effectName
  });
}
var collectedErrors = [];
var MAX_COLLECTED = 200;
function collectError(whatError) {
  if (!__DEV__) return;
  collectedErrors.push({
    ...whatError.toJSON(),
    timestamp: Date.now()
  });
  if (collectedErrors.length > MAX_COLLECTED) {
    collectedErrors = collectedErrors.slice(-MAX_COLLECTED);
  }
}
function getCollectedErrors(since) {
  if (since) return collectedErrors.filter((e) => e.timestamp > since);
  return collectedErrors.slice();
}
function clearCollectedErrors() {
  collectedErrors = [];
}
function classifyError(err, context = {}) {
  const msg = err?.message || String(err);
  if (msg.includes("infinite effect loop") || msg.includes("25 iterations")) {
    return createWhatError("INFINITE_EFFECT", context);
  }
  if (msg.includes("hydration") || msg.includes("Hydration")) {
    return createWhatError("HYDRATION_MISMATCH", context);
  }
  if (msg.includes("Signal.set() called inside a computed")) {
    return createWhatError("SIGNAL_WRITE_IN_RENDER", {
      ...context,
      signalName: msg.match(/signal: (\w+)/)?.[1] || context.signalName
    });
  }
  return new WhatError({
    code: "ERR_RUNTIME",
    message: msg,
    suggestion: "Check the stack trace and component context for more details.",
    ...context
  });
}

// packages/core/src/guardrails.js
var guardrails = {
  signalReadDetection: true,
  componentNaming: true,
  importValidation: true
};
function configureGuardrails(overrides) {
  Object.assign(guardrails, overrides);
}
function getGuardrailConfig() {
  return { ...guardrails };
}
function installSignalReadGuardrail(signalFn, debugName) {
  if (!__DEV__ || !guardrails.signalReadDetection) return signalFn;
  signalFn.toString = function() {
    const err = createWhatError("MISSING_SIGNAL_READ", {
      signalName: debugName || "(unnamed)"
    });
    console.warn(`[what] ${err.message}
  Suggestion: ${err.suggestion}`);
    collectError(err);
    return String(signalFn());
  };
  signalFn.valueOf = function() {
    const err = createWhatError("MISSING_SIGNAL_READ", {
      signalName: debugName || "(unnamed)"
    });
    console.warn(`[what] ${err.message}
  Suggestion: ${err.suggestion}`);
    collectError(err);
    return signalFn();
  };
  return signalFn;
}
function checkComponentName(name) {
  if (!__DEV__ || !guardrails.componentNaming) return null;
  if (!name) return null;
  if (/^[A-Z]/.test(name)) return null;
  const suggestion = `Component "${name}" should use PascalCase (e.g., "${capitalize(name)}"). PascalCase distinguishes components from HTML elements in JSX and is required by the What Framework compiler.`;
  console.warn(`[what] ${suggestion}`);
  return { code: "WARN_COMPONENT_NAMING", name, suggestion };
}
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
var VALID_EXPORTS = /* @__PURE__ */ new Set([
  // Reactive primitives
  "signal",
  "computed",
  "effect",
  "signalMemo",
  "batch",
  "untrack",
  "flushSync",
  "createRoot",
  "getOwner",
  "runWithOwner",
  "onRootCleanup",
  "__setDevToolsHooks",
  // Rendering
  "template",
  "_template",
  "svgTemplate",
  "insert",
  "mapArray",
  "spread",
  "setProp",
  "delegateEvents",
  "on",
  "classList",
  "hydrate",
  "isHydrating",
  "_$createComponent",
  // JSX
  "h",
  "Fragment",
  "html",
  // DOM
  "mount",
  // Hooks
  "useState",
  "useSignal",
  "useComputed",
  "useEffect",
  "useMemo",
  "useCallback",
  "useRef",
  "useContext",
  "useReducer",
  "createContext",
  "onMount",
  "onCleanup",
  "createResource",
  // Components
  "memo",
  "lazy",
  "Suspense",
  "ErrorBoundary",
  "Show",
  "For",
  "Switch",
  "Match",
  "Island",
  // Store
  "createStore",
  "derived",
  "storeComputed",
  "atom",
  // Head
  "Head",
  "clearHead",
  // Utilities
  "each",
  "cls",
  "style",
  "debounce",
  "throttle",
  "useMediaQuery",
  "useLocalStorage",
  "useClickOutside",
  "Portal",
  "transition",
  // Scheduler
  "scheduleRead",
  "scheduleWrite",
  "flushScheduler",
  "measure",
  "mutate",
  "useScheduledEffect",
  "nextFrame",
  "raf",
  "onResize",
  "onIntersect",
  "smoothScrollTo",
  // Text insertion hook (for external text engines)
  "_setTextInsertHook",
  // Animation
  "spring",
  "tween",
  "easings",
  "useTransition",
  "useGesture",
  "useAnimatedValue",
  "createTransitionClasses",
  "cssTransition",
  // Accessibility
  "useFocus",
  "useFocusRestore",
  "useFocusTrap",
  "FocusTrap",
  "announce",
  "announceAssertive",
  "SkipLink",
  "useAriaExpanded",
  "useAriaSelected",
  "useAriaChecked",
  "useRovingTabIndex",
  "VisuallyHidden",
  "LiveRegion",
  "useId",
  "useIds",
  "useDescribedBy",
  "useLabelledBy",
  "Keys",
  "onKey",
  "onKeys",
  // Skeleton
  "Skeleton",
  "SkeletonText",
  "SkeletonAvatar",
  "SkeletonCard",
  "SkeletonTable",
  "IslandSkeleton",
  "useSkeleton",
  "Placeholder",
  "LoadingDots",
  "Spinner",
  // Data fetching
  "useFetch",
  "useSWR",
  "useQuery",
  "useInfiniteQuery",
  "invalidateQueries",
  "prefetchQuery",
  "setQueryData",
  "getQueryData",
  "clearCache",
  "__getCacheSnapshot",
  // Form
  "useForm",
  "useField",
  "rules",
  "simpleResolver",
  "zodResolver",
  "yupResolver",
  "Input",
  "Textarea",
  "Select",
  "Checkbox",
  "Radio",
  "ErrorMessage"
]);
function validateImports(importNames) {
  if (!__DEV__ || !guardrails.importValidation) return [];
  const invalid = [];
  for (const name of importNames) {
    if (!VALID_EXPORTS.has(name)) {
      invalid.push({
        name,
        message: `"${name}" is not a valid export from what-framework.`,
        suggestion: `Check the API reference. Did you mean: ${findClosest(name)}?`
      });
    }
  }
  return invalid;
}
function findClosest(input) {
  const lower = input.toLowerCase();
  let best = null;
  let bestDist = Infinity;
  for (const name of VALID_EXPORTS) {
    const dist = levenshtein(lower, name.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return bestDist <= 3 ? best : "(no close match found)";
}
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

// packages/core/src/agent-context.js
var VERSION = "0.10.0";
var mountedComponents = [];
function registerComponent(component) {
  if (!__DEV__) return;
  mountedComponents.push(component);
}
function unregisterComponent(component) {
  if (!__DEV__) return;
  const idx = mountedComponents.indexOf(component);
  if (idx >= 0) mountedComponents.splice(idx, 1);
}
function getMountedComponents() {
  return mountedComponents.slice();
}
var activeSignals = [];
function registerSignal(sig) {
  if (!__DEV__) return;
  activeSignals.push(sig);
}
function unregisterSignal(sig) {
  if (!__DEV__) return;
  const idx = activeSignals.indexOf(sig);
  if (idx >= 0) activeSignals.splice(idx, 1);
}
function getActiveSignals() {
  return activeSignals.slice();
}
function getHealth() {
  const errors = getCollectedErrors();
  const recentErrors = errors.filter((e) => Date.now() - e.timestamp < 6e4);
  const cycleErrors = errors.filter((e) => e.code === "ERR_INFINITE_EFFECT");
  const effectCycleRisk = cycleErrors.length > 0;
  const orphanErrors = errors.filter((e) => e.code === "ERR_ORPHAN_EFFECT");
  const signalLeaks = activeSignals.filter((s) => {
    if (s._subs && s._subs.size === 0) return true;
    return false;
  }).length;
  const totalSignals = activeSignals.length;
  const memoryPressure = totalSignals > 1e4 ? "high" : totalSignals > 1e3 ? "medium" : "low";
  return {
    effectCycleRisk,
    orphanEffects: orphanErrors.length,
    signalLeaks,
    memoryPressure,
    recentErrorCount: recentErrors.length,
    totalSignals,
    totalComponents: mountedComponents.length
  };
}
function installAgentContext() {
  if (!__DEV__) return;
  if (typeof globalThis === "undefined") return;
  globalThis.__WHAT_AGENT__ = {
    framework: "what-framework",
    version: VERSION,
    mode: "development",
    features: ["signals", "effects", "computed", "ssr", "islands", "router", "stores", "forms", "animations", "a11y"],
    // Live accessors — always return current state
    components: () => getMountedComponents().map((c) => ({
      id: c.id,
      name: c.name || c.displayName || c.constructor?.name
    })),
    signals: () => getActiveSignals().map((s, i) => ({
      id: i,
      name: s._debugName || `signal_${i}`,
      value: typeof s === "function" ? s.peek?.() : void 0,
      subscriberCount: s._subs ? s._subs.size : 0
    })),
    errors: () => getCollectedErrors(),
    health: () => getHealth(),
    // Metadata for agents
    api: {
      reactive: ["signal", "computed", "effect", "batch", "untrack", "flushSync", "createRoot", "memo"],
      hooks: ["useState", "useSignal", "useComputed", "useEffect", "useMemo", "useCallback", "useRef", "useContext", "onMount", "onCleanup"],
      components: ["Show", "For", "Switch", "Match", "Suspense", "ErrorBoundary", "lazy", "Island"],
      data: ["useSWR", "useQuery", "useFetch", "useInfiniteQuery"],
      store: ["createStore", "derived", "atom"]
    }
  };
}
export {
  Checkbox,
  ERROR_CODES,
  ErrorBoundary,
  ErrorMessage,
  FocusTrap,
  For,
  Fragment,
  Head,
  Input,
  Island,
  IslandSkeleton,
  Keys,
  LiveRegion,
  LoadingDots,
  Match,
  Placeholder,
  Portal,
  Radio,
  Select,
  Show,
  Skeleton,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTable,
  SkeletonText,
  SkipLink,
  Spinner,
  Suspense,
  Switch,
  Textarea,
  VisuallyHidden,
  WhatError,
  _$createComponent,
  _$templateImpl as _$template,
  __drainPreinstallBuffer,
  __getCacheSnapshot,
  __readHydrationData,
  __resetHydrationData,
  __setDevToolsHooks,
  _setTextInsertHook,
  template as _template,
  announce,
  announceAssertive,
  atom,
  batch,
  beginHeadCollection,
  checkComponentName,
  classList,
  classifyError,
  clearCache,
  clearCollectedErrors,
  clearHead,
  cls,
  collectError,
  computed,
  configureGuardrails,
  createContext,
  createResource,
  createRoot,
  createStore,
  createTransitionClasses,
  createWhatError,
  cssTransition,
  debounce,
  delegateEvents,
  derived,
  each,
  easings,
  effect,
  endHeadCollection,
  flushScheduler,
  flushSync,
  getActiveSignals,
  getCollectedErrors,
  getGuardrailConfig,
  getHealth,
  getLoaderData,
  getMountedComponents,
  getOwner,
  getQueryData,
  getResource,
  getServerContext,
  h,
  html,
  hydrate,
  insert,
  installAgentContext,
  installSignalReadGuardrail,
  invalidateQueries,
  isHydrating,
  lazy,
  mapArray,
  measure,
  memo2 as memo,
  mount,
  mutate,
  nextFrame,
  on,
  onCleanup2 as onCleanup,
  onIntersect,
  onKey,
  onKeys,
  onMount,
  onResize,
  onCleanup as onRootCleanup,
  prefetchQuery,
  raf,
  registerComponent,
  registerSignal,
  rules,
  runWithOwner,
  runWithServerContext,
  scheduleRead,
  scheduleWrite,
  setProp,
  setQueryData,
  setServerContext,
  signal,
  memo as signalMemo,
  simpleResolver,
  smoothScrollTo,
  spread,
  spring,
  storeComputed,
  style,
  svgTemplate,
  template,
  throttle,
  transition,
  tween,
  unregisterComponent,
  unregisterSignal,
  untrack,
  useAnimatedValue,
  useAriaChecked,
  useAriaExpanded,
  useAriaSelected,
  useCallback,
  useClickOutside,
  useComputed,
  useContext,
  useDescribedBy,
  useEffect,
  useFetch,
  useField,
  useFocus,
  useFocusRestore,
  useFocusTrap,
  useForm,
  useGesture,
  useId,
  useIds,
  useInfiniteQuery,
  useLabelledBy,
  useLoaderData,
  useLocalStorage,
  useMediaQuery,
  useMemo,
  useQuery,
  useReducer,
  useRef,
  useRovingTabIndex,
  useSWR,
  useScheduledEffect,
  useSignal,
  useSkeleton,
  useState,
  useTransition,
  validateImports,
  yupResolver,
  zodResolver
};
//# sourceMappingURL=index.js.map
