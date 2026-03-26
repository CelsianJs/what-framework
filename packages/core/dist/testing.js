// packages/core/src/reactive.js
var __DEV__ = typeof process !== "undefined" ? true : true;
var __devtools = null;
var currentEffect = null;
var currentRoot = null;
var currentOwner = null;
var insideComputed = false;
var batchDepth = 0;
var pendingEffects = [];
var pendingNeedSort = false;
var subSetOwner = /* @__PURE__ */ new WeakMap();
var NEEDS_UPSTREAM = /* @__PURE__ */ Symbol("needs_upstream");
function signal(initial, debugName) {
  let value = initial;
  const subs = /* @__PURE__ */ new Set();
  function sig(...args) {
    if (args.length === 0) {
      if (currentEffect) {
        subs.add(currentEffect);
        currentEffect.deps.push(subs);
      }
      return value;
    }
    if (__DEV__ && insideComputed) {
      console.warn(
        "[what] Signal.set() called inside a computed function. This may cause infinite loops. Use effect() instead." + (debugName ? ` (signal: ${debugName})` : "")
      );
    }
    const nextVal = typeof args[0] === "function" ? args[0](value) : args[0];
    if (Object.is(value, nextVal)) return;
    value = nextVal;
    if (__DEV__ && __devtools) __devtools.onSignalUpdate(sig);
    if (subs.size > 0) notify(subs);
  }
  sig.set = (next) => {
    if (__DEV__ && insideComputed) {
      console.warn(
        "[what] Signal.set() called inside a computed function. This may cause infinite loops. Use effect() instead." + (debugName ? ` (signal: ${debugName})` : "")
      );
    }
    const nextVal = typeof next === "function" ? next(value) : next;
    if (Object.is(value, nextVal)) return;
    value = nextVal;
    if (__DEV__ && __devtools) __devtools.onSignalUpdate(sig);
    if (subs.size > 0) notify(subs);
  };
  sig.peek = () => value;
  sig.subscribe = (fn) => {
    return effect(() => fn(sig()));
  };
  sig._signal = true;
  if (__DEV__) {
    sig._subs = subs;
    if (debugName) sig._debugName = debugName;
  }
  if (__DEV__ && __devtools) __devtools.onSignalCreate(sig);
  return sig;
}
function _updateLevel(e) {
  let maxDepLevel = 0;
  const deps = e.deps;
  for (let i = 0; i < deps.length; i++) {
    const owner = subSetOwner.get(deps[i]);
    if (owner) {
      const depLevel = owner._level;
      if (depLevel > maxDepLevel) maxDepLevel = depLevel;
    }
  }
  e._level = maxDepLevel + 1;
}
function effect(fn, opts) {
  const e = _createEffect(fn);
  e._level = 1;
  const prev = currentEffect;
  currentEffect = e;
  try {
    const result = e.fn();
    if (typeof result === "function") e._cleanup = result;
  } finally {
    currentEffect = prev;
  }
  _updateLevel(e);
  if (opts?.stable) e._stable = true;
  const dispose = () => _disposeEffect(e);
  if (currentRoot) {
    currentRoot.disposals.push(dispose);
  }
  return dispose;
}
function _createEffect(fn, lazy) {
  const e = {
    fn,
    deps: [],
    // array of subscriber sets (cheaper than Set for typical 1-3 deps)
    lazy: lazy || false,
    _onNotify: null,
    disposed: false,
    _pending: false,
    _stable: false,
    // stable effects skip cleanup/re-subscribe on re-run
    _level: 0,
    // topological depth: signals=0, computed/effects=max(deps)+1
    _computed: false,
    // true for computed inner effects
    _computedSubs: null,
    // reference to the computed's subscriber set
    _isDirty: null,
    // function to check if computed is dirty (set by computed())
    _markDirty: null
    // function to mark computed dirty (set by computed())
  };
  if (__DEV__ && __devtools) __devtools.onEffectCreate(e);
  return e;
}
function _runEffect(e) {
  if (e.disposed) return;
  if (e._stable) {
    if (e._cleanup) {
      try {
        e._cleanup();
      } catch (err) {
        if (__DEV__) console.warn("[what] Error in effect cleanup:", err);
      }
      e._cleanup = null;
    }
    const prev2 = currentEffect;
    currentEffect = null;
    try {
      const result = e.fn();
      if (typeof result === "function") e._cleanup = result;
    } catch (err) {
      if (__devtools?.onError) __devtools.onError(err, { type: "effect", effect: e });
      if (__DEV__) console.warn("[what] Error in stable effect:", err);
    } finally {
      currentEffect = prev2;
    }
    if (__DEV__ && __devtools?.onEffectRun) __devtools.onEffectRun(e);
    return;
  }
  cleanup(e);
  if (e._cleanup) {
    try {
      e._cleanup();
    } catch (err) {
      if (__devtools?.onError) __devtools.onError(err, { type: "effect-cleanup", effect: e });
      if (__DEV__) console.warn("[what] Error in effect cleanup:", err);
    }
    e._cleanup = null;
  }
  const prev = currentEffect;
  currentEffect = e;
  try {
    const result = e.fn();
    if (typeof result === "function") {
      e._cleanup = result;
    }
  } catch (err) {
    if (err === NEEDS_UPSTREAM) throw err;
    if (__devtools?.onError) __devtools.onError(err, { type: "effect", effect: e });
    throw err;
  } finally {
    currentEffect = prev;
  }
  if (__DEV__ && __devtools?.onEffectRun) __devtools.onEffectRun(e);
}
function _disposeEffect(e) {
  e.disposed = true;
  if (__DEV__ && __devtools) __devtools.onEffectDispose(e);
  cleanup(e);
  if (e._cleanup) {
    try {
      e._cleanup();
    } catch (err) {
      if (__DEV__) console.warn("[what] Error in effect cleanup on dispose:", err);
    }
    e._cleanup = null;
  }
}
function cleanup(e) {
  const deps = e.deps;
  for (let i = 0; i < deps.length; i++) deps[i].delete(e);
  deps.length = 0;
}
var notifyDepth = 0;
var notifyQueue = null;
var notifyQueueLen = 0;
function notify(subs) {
  if (notifyDepth === 0) {
    notifyDepth = 1;
    try {
      for (const e of subs) {
        if (e.disposed) continue;
        if (e._onNotify) {
          e._onNotify();
        } else if (batchDepth === 0 && e._stable) {
          const prev = currentEffect;
          currentEffect = null;
          try {
            const result = e.fn();
            if (typeof result === "function") {
              if (e._cleanup) try {
                e._cleanup();
              } catch (err) {
              }
              e._cleanup = result;
            }
          } catch (err) {
            if (__devtools?.onError) __devtools.onError(err, { type: "effect", effect: e });
            if (__DEV__) console.warn("[what] Error in stable effect:", err);
          } finally {
            currentEffect = prev;
          }
        } else if (!e._pending) {
          e._pending = true;
          const level = e._level;
          const len = pendingEffects.length;
          if (len > 0 && pendingEffects[len - 1]._level > level) {
            pendingNeedSort = true;
          }
          pendingEffects.push(e);
        }
      }
      if (notifyQueueLen > 0) {
        let qi = 0;
        while (qi < notifyQueueLen) {
          const queuedSubs = notifyQueue[qi];
          notifyQueue[qi] = null;
          qi++;
          for (const e of queuedSubs) {
            if (e.disposed) continue;
            if (e._onNotify) {
              e._onNotify();
            } else if (batchDepth === 0 && e._stable) {
              const prev = currentEffect;
              currentEffect = null;
              try {
                const result = e.fn();
                if (typeof result === "function") {
                  if (e._cleanup) try {
                    e._cleanup();
                  } catch (err) {
                  }
                  e._cleanup = result;
                }
              } catch (err) {
                if (__devtools?.onError) __devtools.onError(err, { type: "effect", effect: e });
                if (__DEV__) console.warn("[what] Error in stable effect:", err);
              } finally {
                currentEffect = prev;
              }
            } else if (!e._pending) {
              e._pending = true;
              const level = e._level;
              const len = pendingEffects.length;
              if (len > 0 && pendingEffects[len - 1]._level > level) {
                pendingNeedSort = true;
              }
              pendingEffects.push(e);
            }
          }
        }
        notifyQueueLen = 0;
      }
    } finally {
      notifyDepth = 0;
    }
    if (batchDepth === 0 && pendingEffects.length > 0) scheduleMicrotask();
  } else {
    if (notifyQueue === null) notifyQueue = [];
    if (notifyQueueLen >= notifyQueue.length) {
      notifyQueue.push(subs);
    } else {
      notifyQueue[notifyQueueLen] = subs;
    }
    notifyQueueLen++;
  }
}
var microtaskScheduled = false;
function scheduleMicrotask() {
  if (!microtaskScheduled) {
    microtaskScheduled = true;
    queueMicrotask(() => {
      microtaskScheduled = false;
      flush();
    });
  }
}
function flush() {
  let iterations = 0;
  while (pendingEffects.length > 0 && iterations < 25) {
    const batch2 = pendingEffects;
    pendingEffects = [];
    if (batch2.length > 1 && pendingNeedSort) {
      batch2.sort((a, b) => a._level - b._level);
    }
    pendingNeedSort = false;
    for (let i = 0; i < batch2.length; i++) {
      const e = batch2[i];
      e._pending = false;
      if (!e.disposed && !e._onNotify) {
        const prevDepsLen = e.deps.length;
        _runEffect(e);
        if (!e._computed && e.deps.length !== prevDepsLen) {
          _updateLevel(e);
        }
      }
    }
    iterations++;
  }
  if (iterations >= 25) {
    if (__DEV__) {
      const remaining = pendingEffects.slice(0, 3);
      const effectNames = remaining.map((e) => e.fn?.name || e.fn?.toString().slice(0, 60) || "(anonymous)");
      console.warn(
        `[what] Possible infinite effect loop detected (25 iterations). Likely cause: an effect writes to a signal it also reads, creating a cycle. Use untrack() to read signals without subscribing. Looping effects: ${effectNames.join(", ")}`
      );
    } else {
      console.warn("[what] Possible infinite effect loop detected");
    }
    for (let i = 0; i < pendingEffects.length; i++) pendingEffects[i]._pending = false;
    pendingEffects.length = 0;
  }
}
function flushSync() {
  microtaskScheduled = false;
  flush();
}
function untrack(fn) {
  const prev = currentEffect;
  currentEffect = null;
  try {
    return fn();
  } finally {
    currentEffect = prev;
  }
}
function createRoot(fn) {
  const prevRoot = currentRoot;
  const prevOwner = currentOwner;
  const root = {
    disposals: [],
    owner: currentOwner,
    // parent owner for ownership tree
    children: [],
    // child roots (ownership tree)
    _disposed: false
  };
  if (currentOwner) {
    currentOwner.children.push(root);
  }
  currentRoot = root;
  currentOwner = root;
  try {
    const dispose = () => {
      if (root._disposed) return;
      root._disposed = true;
      for (let i = root.children.length - 1; i >= 0; i--) {
        _disposeRoot(root.children[i]);
      }
      root.children.length = 0;
      for (let i = root.disposals.length - 1; i >= 0; i--) {
        root.disposals[i]();
      }
      root.disposals.length = 0;
      if (root.owner) {
        const idx = root.owner.children.indexOf(root);
        if (idx >= 0) root.owner.children.splice(idx, 1);
      }
    };
    return fn(dispose);
  } finally {
    currentRoot = prevRoot;
    currentOwner = prevOwner;
  }
}
function _disposeRoot(root) {
  if (root._disposed) return;
  root._disposed = true;
  for (let i = root.children.length - 1; i >= 0; i--) {
    _disposeRoot(root.children[i]);
  }
  root.children.length = 0;
  for (let i = root.disposals.length - 1; i >= 0; i--) {
    root.disposals[i]();
  }
  root.disposals.length = 0;
}

// packages/core/src/h.js
var EMPTY_OBJ = /* @__PURE__ */ Object.create(null);
function h(tag, props, ...children) {
  props = props || EMPTY_OBJ;
  const flat = flattenChildren(children);
  const key = props.key ?? null;
  if (props.key !== void 0) {
    props = { ...props };
    delete props.key;
  }
  return { tag, props, children: flat, key, _vnode: true };
}
function flattenChildren(children) {
  const out = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) {
      out.push(...flattenChildren(child));
    } else if (typeof child === "object" && child._vnode) {
      out.push(child);
    } else if (typeof child === "function") {
      out.push(child);
    } else {
      out.push(String(child));
    }
  }
  return out;
}

// packages/core/src/components.js
var _getCurrentComponent = null;
function _injectGetCurrentComponent(fn) {
  _getCurrentComponent = fn;
}
function reportError(error, startCtx) {
  let ctx = startCtx || _getCurrentComponent?.();
  while (ctx) {
    if (ctx._errorBoundary) {
      ctx._errorBoundary(error);
      return true;
    }
    ctx = ctx._parentCtx;
  }
  return false;
}

// packages/core/src/helpers.js
var _getCurrentComponentRef = null;
function _setComponentRef(fn) {
  _getCurrentComponentRef = fn;
}

// packages/core/src/dom.js
var SVG_ELEMENTS = /* @__PURE__ */ new Set([
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "g",
  "defs",
  "use",
  "symbol",
  "clipPath",
  "mask",
  "pattern",
  "image",
  "text",
  "tspan",
  "textPath",
  "foreignObject",
  "linearGradient",
  "radialGradient",
  "stop",
  "marker",
  "animate",
  "animateTransform",
  "animateMotion",
  "set",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feFlood",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "feSpecularLighting",
  "feTile",
  "feTurbulence"
]);
var SVG_NS = "http://www.w3.org/2000/svg";
var mountedComponents = /* @__PURE__ */ new Set();
var _commentCtxMap = /* @__PURE__ */ new WeakMap();
function isDomNode(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof Node !== "undefined" && value instanceof Node) return true;
  return typeof value.nodeType === "number" && typeof value.nodeName === "string";
}
function isVNode(value) {
  return !!value && typeof value === "object" && (value._vnode === true || "tag" in value);
}
function disposeComponent(ctx) {
  if (ctx.disposed) return;
  ctx.disposed = true;
  if (ctx.cleanups) {
    for (const cleanup3 of ctx.cleanups) {
      try {
        cleanup3();
      } catch (e) {
        console.error("[what] cleanup error:", e);
      }
    }
  }
  if (ctx.effects) {
    for (const dispose of ctx.effects) {
      try {
        dispose();
      } catch (e) {
      }
    }
  }
  if (ctx.hooks) {
    for (const hook of ctx.hooks) {
      if (hook && typeof hook.cleanup === "function") {
        try {
          hook.cleanup();
        } catch (e) {
          console.error("[what] hook cleanup error:", e);
        }
      }
    }
  }
  if (ctx._cleanupCallbacks) {
    for (const fn of ctx._cleanupCallbacks) {
      try {
        fn();
      } catch (e) {
        console.error("[what] onCleanup error:", e);
      }
    }
  }
  if (__DEV__ && __devtools?.onComponentUnmount) __devtools.onComponentUnmount(ctx);
  mountedComponents.delete(ctx);
}
function disposeTree(node) {
  if (!node) return;
  if (node._componentCtx) {
    disposeComponent(node._componentCtx);
  }
  const commentCtx = _commentCtxMap.get(node);
  if (commentCtx) {
    disposeComponent(commentCtx);
  }
  if (node._dispose) {
    try {
      node._dispose();
    } catch (e) {
    }
  }
  if (node._propEffects) {
    for (const key in node._propEffects) {
      try {
        node._propEffects[key]();
      } catch (e) {
      }
    }
  }
  if (node.childNodes) {
    for (const child of node.childNodes) {
      disposeTree(child);
    }
  }
}
function mount(vnode, container2) {
  if (typeof container2 === "string") {
    container2 = document.querySelector(container2);
  }
  disposeTree(container2);
  container2.textContent = "";
  const node = createDOM(vnode, container2);
  if (node) container2.appendChild(node);
  return () => {
    disposeTree(container2);
    container2.textContent = "";
  };
}
function createDOM(vnode, parent, isSvg) {
  if (vnode == null || vnode === false || vnode === true) {
    return document.createComment("");
  }
  if (typeof vnode === "string" || typeof vnode === "number") {
    return document.createTextNode(String(vnode));
  }
  if (isDomNode(vnode)) {
    return vnode;
  }
  if (typeof vnode === "function") {
    const startMarker = document.createComment("fn");
    const endMarker = document.createComment("/fn");
    let currentNodes = [];
    const frag = document.createDocumentFragment();
    frag.appendChild(startMarker);
    frag.appendChild(endMarker);
    const dispose = effect(() => {
      const val = vnode();
      const vnodes = val == null || val === false || val === true ? [] : Array.isArray(val) ? val : [val];
      const realParent = endMarker.parentNode;
      if (!realParent) return;
      for (const old of currentNodes) {
        disposeTree(old);
        if (old.parentNode === realParent) realParent.removeChild(old);
      }
      currentNodes = [];
      for (const v of vnodes) {
        const node = createDOM(v, realParent, parent?._isSvg);
        if (node) {
          if (node.nodeType === 11) {
            const children = Array.from(node.childNodes);
            realParent.insertBefore(node, endMarker);
            for (const child of children) currentNodes.push(child);
          } else {
            realParent.insertBefore(node, endMarker);
            currentNodes.push(node);
          }
        }
      }
    });
    startMarker._dispose = dispose;
    endMarker._dispose = dispose;
    return frag;
  }
  if (Array.isArray(vnode)) {
    const frag = document.createDocumentFragment();
    for (const child of vnode) {
      const node = createDOM(child, parent, isSvg);
      if (node) frag.appendChild(node);
    }
    return frag;
  }
  if (isVNode(vnode) && typeof vnode.tag === "function") {
    return createComponent(vnode, parent, isSvg);
  }
  if (isVNode(vnode)) {
    return createElementFromVNode(vnode, parent, isSvg);
  }
  return document.createTextNode(String(vnode));
}
var componentStack = [];
function getCurrentComponent() {
  return componentStack[componentStack.length - 1];
}
_injectGetCurrentComponent(getCurrentComponent);
_setComponentRef(getCurrentComponent);
function createComponent(vnode, parent, isSvg) {
  let { tag: Component, props, children } = vnode;
  if (typeof Component === "function" && (Component.prototype?.isReactComponent || Component.prototype?.render)) {
    const ClassComp = Component;
    Component = function ClassComponentBridge(props2) {
      const instance = new ClassComp(props2);
      return instance.render();
    };
    Component.displayName = ClassComp.displayName || ClassComp.name || "ClassComponent";
  }
  if (Component === "__errorBoundary" || vnode.tag === "__errorBoundary") {
    return createErrorBoundary(vnode, parent);
  }
  if (Component === "__suspense" || vnode.tag === "__suspense") {
    return createSuspenseBoundary(vnode, parent);
  }
  if (Component === "__portal" || vnode.tag === "__portal") {
    return createPortalDOM(vnode, parent);
  }
  const ctx = {
    hooks: [],
    hookIndex: 0,
    effects: [],
    cleanups: [],
    mounted: false,
    disposed: false,
    Component,
    _parentCtx: componentStack[componentStack.length - 1] || null,
    _errorBoundary: (() => {
      let p = componentStack[componentStack.length - 1];
      while (p) {
        if (p._errorBoundary) return p._errorBoundary;
        p = p._parentCtx;
      }
      return null;
    })()
  };
  const startComment = document.createComment("c:start");
  const endComment = document.createComment("c:end");
  _commentCtxMap.set(startComment, ctx);
  ctx._startComment = startComment;
  ctx._endComment = endComment;
  const container2 = document.createDocumentFragment();
  container2._componentCtx = ctx;
  ctx._wrapper = startComment;
  mountedComponents.add(ctx);
  if (__DEV__ && __devtools?.onComponentMount) __devtools.onComponentMount(ctx);
  const propsChildren = children.length === 0 ? void 0 : children.length === 1 ? children[0] : children;
  const propsSignal = signal({ ...props, children: propsChildren });
  ctx._propsSignal = propsSignal;
  const reactiveProps = new Proxy({}, {
    get(_, key) {
      const current = propsSignal();
      return current[key];
    },
    has(_, key) {
      const current = propsSignal();
      return key in current;
    },
    ownKeys() {
      const current = propsSignal();
      return Reflect.ownKeys(current);
    },
    getOwnPropertyDescriptor(_, key) {
      const current = propsSignal();
      if (key in current) {
        return { value: current[key], writable: false, enumerable: true, configurable: true };
      }
      return void 0;
    }
  });
  componentStack.push(ctx);
  let result;
  try {
    result = Component(reactiveProps);
  } catch (error) {
    componentStack.pop();
    if (!reportError(error, ctx)) {
      console.error("[what] Uncaught error in component:", Component.name || "Anonymous", error);
      throw error;
    }
    container2.appendChild(startComment);
    container2.appendChild(endComment);
    return container2;
  }
  componentStack.pop();
  ctx.mounted = true;
  if (ctx._mountCallbacks) {
    queueMicrotask(() => {
      if (ctx.disposed) return;
      for (const fn of ctx._mountCallbacks) {
        try {
          fn();
        } catch (e) {
          console.error("[what] onMount error:", e);
        }
      }
    });
  }
  container2.appendChild(startComment);
  const vnodes = Array.isArray(result) ? result : [result];
  for (const v of vnodes) {
    const node = createDOM(v, container2, isSvg);
    if (node) container2.appendChild(node);
  }
  container2.appendChild(endComment);
  return container2;
}
function createErrorBoundary(vnode, parent) {
  const { errorState, handleError, fallback, reset } = vnode.props;
  const children = vnode.children;
  const wrapper = document.createElement("span");
  wrapper.style.display = "contents";
  const boundaryCtx = {
    hooks: [],
    hookIndex: 0,
    effects: [],
    cleanups: [],
    mounted: false,
    disposed: false,
    _parentCtx: componentStack[componentStack.length - 1] || null,
    _errorBoundary: handleError
  };
  wrapper._componentCtx = boundaryCtx;
  const dispose = effect(() => {
    const error = errorState();
    componentStack.push(boundaryCtx);
    while (wrapper.firstChild) {
      disposeTree(wrapper.firstChild);
      wrapper.removeChild(wrapper.firstChild);
    }
    let vnodes;
    if (error) {
      vnodes = typeof fallback === "function" ? [fallback({ error, reset })] : [fallback];
    } else {
      vnodes = children;
    }
    vnodes = Array.isArray(vnodes) ? vnodes : [vnodes];
    for (const v of vnodes) {
      const node = createDOM(v, wrapper);
      if (node) wrapper.appendChild(node);
    }
    componentStack.pop();
  });
  boundaryCtx.effects.push(dispose);
  return wrapper;
}
function createSuspenseBoundary(vnode, parent) {
  const { boundary, fallback, loading } = vnode.props;
  const children = vnode.children;
  const wrapper = document.createElement("span");
  wrapper.style.display = "contents";
  const boundaryCtx = {
    hooks: [],
    hookIndex: 0,
    effects: [],
    cleanups: [],
    mounted: false,
    disposed: false,
    _parentCtx: componentStack[componentStack.length - 1] || null
  };
  wrapper._componentCtx = boundaryCtx;
  const dispose = effect(() => {
    const isLoading = loading();
    const vnodes = isLoading ? [fallback] : children;
    const normalized = Array.isArray(vnodes) ? vnodes : [vnodes];
    componentStack.push(boundaryCtx);
    while (wrapper.firstChild) {
      disposeTree(wrapper.firstChild);
      wrapper.removeChild(wrapper.firstChild);
    }
    for (const v of normalized) {
      const node = createDOM(v, wrapper);
      if (node) wrapper.appendChild(node);
    }
    componentStack.pop();
  });
  boundaryCtx.effects.push(dispose);
  return wrapper;
}
function createPortalDOM(vnode, parent) {
  const { container: container2 } = vnode.props;
  const children = vnode.children;
  if (!container2) {
    console.warn("[what] Portal: target container not found");
    return document.createComment("portal:empty");
  }
  const portalCtx = {
    hooks: [],
    hookIndex: 0,
    effects: [],
    cleanups: [],
    mounted: false,
    disposed: false,
    _parentCtx: componentStack[componentStack.length - 1] || null
  };
  const placeholder = document.createComment("portal");
  placeholder._componentCtx = portalCtx;
  const portalNodes = [];
  for (const child of children) {
    const node = createDOM(child, container2);
    if (node) {
      container2.appendChild(node);
      portalNodes.push(node);
    }
  }
  portalCtx._cleanupCallbacks = [() => {
    for (const node of portalNodes) {
      disposeTree(node);
      if (node.parentNode) node.parentNode.removeChild(node);
    }
  }];
  return placeholder;
}
function createElementFromVNode(vnode, parent, isSvg) {
  const { tag, props, children } = vnode;
  const svgContext = isSvg || SVG_ELEMENTS.has(tag);
  const el = svgContext ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (props) {
    applyProps(el, props, {}, svgContext);
  }
  for (const child of children) {
    const node = createDOM(child, el, svgContext && tag !== "foreignObject");
    if (node) el.appendChild(node);
  }
  el._vnode = vnode;
  return el;
}
function applyProps(el, newProps, oldProps, isSvg) {
  newProps = newProps || {};
  oldProps = oldProps || {};
  for (const key in newProps) {
    if (key === "key" || key === "children") continue;
    if (key === "ref") {
      if (typeof newProps.ref === "function") newProps.ref(el);
      else if (newProps.ref) newProps.ref.current = el;
      continue;
    }
    setProp(el, key, newProps[key], isSvg);
  }
}
function setProp(el, key, value, isSvg) {
  if (typeof value === "function" && !(key.startsWith("on") && key.length > 2) && key !== "ref") {
    if (!el._propEffects) el._propEffects = {};
    if (el._propEffects[key]) {
      try {
        el._propEffects[key]();
      } catch (e) {
      }
    }
    el._propEffects[key] = effect(() => {
      const resolved = value();
      setProp(el, key, resolved, isSvg);
    });
    return;
  }
  if (key.startsWith("on") && key.length > 2) {
    let eventName = key.slice(2);
    let useCapture = false;
    if (eventName.endsWith("Capture")) {
      eventName = eventName.slice(0, -7);
      useCapture = true;
    }
    const event = eventName.toLowerCase();
    const storageKey = useCapture ? event + "_capture" : event;
    const old = el._events?.[storageKey];
    if (old && old._original === value) return;
    if (old) el.removeEventListener(event, old, useCapture);
    if (value == null) return;
    if (!el._events) el._events = {};
    const wrappedHandler = (e) => {
      if (!e.nativeEvent) e.nativeEvent = e;
      return untrack(() => value(e));
    };
    wrappedHandler._original = value;
    el._events[storageKey] = wrappedHandler;
    const eventOpts = value._eventOpts;
    el.addEventListener(event, wrappedHandler, eventOpts || useCapture || void 0);
    return;
  }
  if (key === "className" || key === "class") {
    if (isSvg) {
      el.setAttribute("class", value || "");
    } else {
      el.className = value || "";
    }
    return;
  }
  if (key === "style") {
    if (typeof value === "string") {
      el.style.cssText = value;
      el._prevStyle = null;
    } else if (typeof value === "object") {
      const oldStyle = el._prevStyle || {};
      for (const prop in oldStyle) {
        if (!(prop in value)) el.style[prop] = "";
      }
      for (const prop in value) {
        el.style[prop] = value[prop] ?? "";
      }
      el._prevStyle = { ...value };
    }
    return;
  }
  if (key === "dangerouslySetInnerHTML") {
    el.innerHTML = value?.__html ?? "";
    return;
  }
  if (key === "innerHTML") {
    if (value == null) return;
    if (value && typeof value === "object" && "__html" in value) {
      el.innerHTML = value.__html ?? "";
    } else {
      if (__DEV__) {
        console.warn(
          "[what] innerHTML received a raw string. This is a security risk (XSS). Use innerHTML={{ __html: trustedString }} or dangerouslySetInnerHTML={{ __html: trustedString }} instead."
        );
      }
      return;
    }
    return;
  }
  if (typeof value === "boolean") {
    if (value) el.setAttribute(key, "");
    else el.removeAttribute(key);
    return;
  }
  if (key.startsWith("data-") || key.startsWith("aria-")) {
    el.setAttribute(key, value);
    return;
  }
  if (isSvg) {
    if (value === false || value == null) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
    return;
  }
  if (key in el) {
    el[key] = value;
  } else {
    el.setAttribute(key, value);
  }
}

// packages/core/src/testing.js
var container = null;
function setupDOM() {
  if (typeof document !== "undefined") {
    container = document.createElement("div");
    container.id = "test-root";
    document.body.appendChild(container);
  }
  return container;
}
function cleanup2() {
  if (container) {
    container.innerHTML = "";
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
  }
}
function render(vnode, options = {}) {
  const { container: customContainer } = options;
  const target = customContainer || setupDOM();
  if (!target) {
    throw new Error("No DOM container available. Are you running in Node.js without jsdom?");
  }
  const unmount = mount(vnode, target);
  return {
    container: target,
    unmount,
    // Query helpers
    getByText: (text) => queryByText(target, text),
    getByTestId: (id) => target.querySelector(`[data-testid="${id}"]`),
    getByRole: (role) => target.querySelector(`[role="${role}"]`),
    getAllByText: (text) => queryAllByText(target, text),
    queryByText: (text) => queryByText(target, text),
    queryByTestId: (id) => target.querySelector(`[data-testid="${id}"]`),
    // Debug
    debug: () => console.log(target.innerHTML),
    // Async utilities
    findByText: (text, timeout) => waitFor(() => queryByText(target, text), { timeout }),
    findByTestId: (id, timeout) => waitFor(() => target.querySelector(`[data-testid="${id}"]`), { timeout })
  };
}
function renderTest(Component, props) {
  const target = setupDOM();
  if (!target) {
    throw new Error("No DOM container available. Are you running in Node.js without jsdom?");
  }
  const signalRegistry = {};
  let rootDispose = null;
  let unmountFn;
  createRoot((dispose) => {
    rootDispose = dispose;
    const vnode = h(Component, props || {});
    unmountFn = mount(vnode, target);
  });
  return {
    container: target,
    // Proxy to access component signals by name
    signals: new Proxy(signalRegistry, {
      get(obj, prop) {
        if (prop in obj) return obj[prop];
        return void 0;
      },
      set(obj, prop, value) {
        obj[prop] = value;
        return true;
      }
    }),
    // Synchronous flush: run all pending effects immediately
    update() {
      flushSync();
    },
    unmount() {
      if (unmountFn) unmountFn();
      if (rootDispose) rootDispose();
      cleanup2();
    },
    // Query helpers
    getByText: (text) => queryByText(target, text),
    getByTestId: (id) => target.querySelector(`[data-testid="${id}"]`),
    queryByText: (text) => queryByText(target, text),
    debug: () => console.log(target.innerHTML)
  };
}
function flushEffects() {
  flushSync();
}
function trackSignals(fn) {
  const accessed = [];
  const written = [];
  const _origSignal = signal;
  const trackedSignals = /* @__PURE__ */ new Map();
  const trackRead = (name) => {
    if (!accessed.includes(name)) accessed.push(name);
  };
  const trackWrite = (name) => {
    if (!written.includes(name)) written.push(name);
  };
  let dispose;
  createRoot((d) => {
    dispose = d;
    const e = effect(() => {
      fn();
    });
  });
  if (dispose) dispose();
  return { accessed, written };
}
function mockSignal(name, initialValue) {
  const history = [initialValue];
  let setCount = 0;
  const s = signal(initialValue, name);
  const origSet = s.set;
  s.set = function(next) {
    const nextVal = typeof next === "function" ? next(s.peek()) : next;
    if (!Object.is(s.peek(), nextVal)) {
      setCount++;
      history.push(nextVal);
    }
    return origSet(nextVal);
  };
  const origFn = s;
  const mock = function(...args) {
    if (args.length === 0) {
      return origFn();
    }
    const nextVal = typeof args[0] === "function" ? args[0](origFn.peek()) : args[0];
    if (!Object.is(origFn.peek(), nextVal)) {
      setCount++;
      history.push(nextVal);
    }
    return origFn(nextVal);
  };
  mock._signal = true;
  mock.peek = s.peek;
  mock.set = s.set;
  mock.subscribe = s.subscribe;
  if (s._debugName) mock._debugName = s._debugName;
  if (s._subs) mock._subs = s._subs;
  Object.defineProperty(mock, "history", {
    get() {
      return history;
    }
  });
  Object.defineProperty(mock, "setCount", {
    get() {
      return setCount;
    }
  });
  mock.reset = function(value) {
    const resetVal = value !== void 0 ? value : initialValue;
    history.length = 0;
    history.push(resetVal);
    setCount = 0;
    origFn(resetVal);
  };
  return mock;
}
function queryByText(container2, text) {
  const regex = text instanceof RegExp ? text : null;
  const walker = document.createTreeWalker(
    container2,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const matches = regex ? regex.test(node.textContent) : node.textContent.includes(text);
    if (matches) {
      return node.parentElement;
    }
  }
  return null;
}
function queryAllByText(container2, text) {
  const results = [];
  const regex = text instanceof RegExp ? text : null;
  const walker = document.createTreeWalker(
    container2,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const matches = regex ? regex.test(node.textContent) : node.textContent.includes(text);
    if (matches) {
      results.push(node.parentElement);
    }
  }
  return results;
}
var fireEvent = {
  click(element) {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: typeof window !== "undefined" ? window : void 0
    });
    element.dispatchEvent(event);
    return event;
  },
  change(element, value) {
    element.value = value;
    const event = new Event("input", { bubbles: true });
    element.dispatchEvent(event);
    const changeEvent = new Event("change", { bubbles: true });
    element.dispatchEvent(changeEvent);
    return changeEvent;
  },
  input(element, value) {
    element.value = value;
    const event = new Event("input", { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },
  submit(element) {
    const event = new Event("submit", { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event;
  },
  focus(element) {
    element.focus();
    const event = new FocusEvent("focus", { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },
  blur(element) {
    element.blur();
    const event = new FocusEvent("blur", { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },
  keyDown(element, key, options = {}) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...options
    });
    element.dispatchEvent(event);
    return event;
  },
  keyUp(element, key, options = {}) {
    const event = new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      key,
      ...options
    });
    element.dispatchEvent(event);
    return event;
  },
  mouseEnter(element) {
    const event = new MouseEvent("mouseenter", { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },
  mouseLeave(element) {
    const event = new MouseEvent("mouseleave", { bubbles: true });
    element.dispatchEvent(event);
    return event;
  }
};
async function waitFor(callback, options = {}) {
  const { timeout = 1e3, interval = 50 } = options;
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const result = callback();
      if (result) return result;
    } catch (e) {
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}
async function waitForElementToBeRemoved(callback, options = {}) {
  const { timeout = 1e3, interval = 50 } = options;
  const startTime = Date.now();
  let element = callback();
  if (!element) {
    throw new Error("Element not found");
  }
  while (Date.now() - startTime < timeout) {
    element = callback();
    if (!element) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Element still present after ${timeout}ms`);
}
async function act(callback) {
  const result = await callback();
  flushSync();
  await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 0));
  return result;
}
function createTestSignal(initial) {
  const s = signal(initial);
  const history = [initial];
  effect(() => {
    history.push(s());
  });
  return {
    signal: s,
    get value() {
      return s();
    },
    set value(v) {
      s.set(v);
    },
    history,
    reset() {
      history.length = 0;
      history.push(s());
    }
  };
}
function mockComponent(name = "MockComponent") {
  const calls = [];
  function Mock(props) {
    calls.push({ props, timestamp: Date.now() });
    return h(
      "div",
      { "data-testid": `mock-${name}` },
      JSON.stringify(props, null, 2)
    );
  }
  Mock.displayName = name;
  Mock.calls = calls;
  Mock.lastCall = () => calls[calls.length - 1];
  Mock.reset = () => {
    calls.length = 0;
  };
  return Mock;
}
var expect = {
  toBeInTheDocument(element) {
    if (!element || !element.parentNode) {
      throw new Error("Expected element to be in the document");
    }
  },
  toHaveTextContent(element, text) {
    if (!element) {
      throw new Error("Element not found");
    }
    const content = element.textContent;
    const matches = text instanceof RegExp ? text.test(content) : content.includes(text);
    if (!matches) {
      throw new Error(`Expected "${content}" to contain "${text}"`);
    }
  },
  toHaveAttribute(element, attr, value) {
    if (!element) {
      throw new Error("Element not found");
    }
    const attrValue = element.getAttribute(attr);
    if (value !== void 0 && attrValue !== value) {
      throw new Error(`Expected attribute "${attr}" to be "${value}", got "${attrValue}"`);
    }
    if (value === void 0 && attrValue === null) {
      throw new Error(`Expected element to have attribute "${attr}"`);
    }
  },
  toHaveClass(element, className) {
    if (!element) {
      throw new Error("Element not found");
    }
    if (!element.classList.contains(className)) {
      throw new Error(`Expected element to have class "${className}"`);
    }
  },
  toBeVisible(element) {
    if (!element) {
      throw new Error("Element not found");
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      throw new Error("Expected element to be visible");
    }
  },
  toBeDisabled(element) {
    if (!element) {
      throw new Error("Element not found");
    }
    if (!element.disabled) {
      throw new Error("Expected element to be disabled");
    }
  },
  toHaveValue(element, value) {
    if (!element) {
      throw new Error("Element not found");
    }
    if (element.value !== value) {
      throw new Error(`Expected value to be "${value}", got "${element.value}"`);
    }
  }
};
var screen = {
  getByText: (text) => queryByText(document.body, text),
  getByTestId: (id) => document.querySelector(`[data-testid="${id}"]`),
  getByRole: (role) => document.querySelector(`[role="${role}"]`),
  getAllByText: (text) => queryAllByText(document.body, text),
  queryByText: (text) => queryByText(document.body, text),
  queryByTestId: (id) => document.querySelector(`[data-testid="${id}"]`),
  debug: () => console.log(document.body.innerHTML)
};
export {
  act,
  cleanup2 as cleanup,
  createTestSignal,
  expect,
  fireEvent,
  flushEffects,
  mockComponent,
  mockSignal,
  render,
  renderTest,
  screen,
  setupDOM,
  trackSignals,
  waitFor,
  waitForElementToBeRemoved
};
//# sourceMappingURL=testing.js.map
