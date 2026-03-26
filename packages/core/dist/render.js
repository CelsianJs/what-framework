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
    for (const cleanup2 of ctx.cleanups) {
      try {
        cleanup2();
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
function getComponentStack() {
  return componentStack;
}
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
  const container = document.createDocumentFragment();
  container._componentCtx = ctx;
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
    container.appendChild(startComment);
    container.appendChild(endComment);
    return container;
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
  container.appendChild(startComment);
  const vnodes = Array.isArray(result) ? result : [result];
  for (const v of vnodes) {
    const node = createDOM(v, container, isSvg);
    if (node) container.appendChild(node);
  }
  container.appendChild(endComment);
  return container;
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
  const { container } = vnode.props;
  const children = vnode.children;
  if (!container) {
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
    const node = createDOM(child, container);
    if (node) {
      container.appendChild(node);
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

// packages/core/src/render.js
function _$createComponent(Component, props, children) {
  if (children && children.length > 0) {
    const mergedChildren = children.length === 1 ? children[0] : children;
    props = props ? { ...props, children: mergedChildren } : { children: mergedChildren };
  }
  return createDOM({ tag: Component, props: props || {}, children: children || [], key: null, _vnode: true });
}
var URL_ATTRS = /* @__PURE__ */ new Set(["href", "src", "action", "formaction", "formAction"]);
function isSafeUrl(url) {
  if (typeof url !== "string") return true;
  const normalized = url.trim().replace(/[\s\x00-\x1f]/g, "").toLowerCase();
  if (normalized.startsWith("javascript:")) return false;
  if (normalized.startsWith("data:")) return false;
  if (normalized.startsWith("vbscript:")) return false;
  return true;
}
var TABLE_WRAPPERS = {
  tr: { depth: 2, wrap: "<table><tbody>", unwrap: "</tbody></table>" },
  td: { depth: 3, wrap: "<table><tbody><tr>", unwrap: "</tr></tbody></table>" },
  th: { depth: 3, wrap: "<table><tbody><tr>", unwrap: "</tr></tbody></table>" },
  thead: { depth: 1, wrap: "<table>", unwrap: "</table>" },
  tbody: { depth: 1, wrap: "<table>", unwrap: "</table>" },
  tfoot: { depth: 1, wrap: "<table>", unwrap: "</table>" },
  colgroup: { depth: 1, wrap: "<table>", unwrap: "</table>" },
  col: { depth: 1, wrap: "<table>", unwrap: "</table>" },
  caption: { depth: 1, wrap: "<table>", unwrap: "</table>" }
};
var SVG_ELEMENTS2 = /* @__PURE__ */ new Set([
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
  "text",
  "tspan",
  "foreignObject",
  "clipPath",
  "mask",
  "pattern",
  "linearGradient",
  "radialGradient",
  "stop",
  "marker",
  "symbol",
  "image",
  "animate",
  "animateTransform",
  "animateMotion",
  "set",
  "filter",
  "feGaussianBlur",
  "feOffset",
  "feMerge",
  "feMergeNode",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feFlood",
  "feImage",
  "feMorphology",
  "feSpecularLighting",
  "feTile",
  "feTurbulence",
  "feDistantLight",
  "fePointLight",
  "feSpotLight"
]);
function getLeadingTag(html) {
  const m = html.match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
  return m ? m[1] : "";
}
function _$templateImpl(html) {
  const trimmed = html.trim();
  const tag = getLeadingTag(trimmed);
  if (SVG_ELEMENTS2.has(tag)) {
    return svgTemplate(trimmed);
  }
  const tableInfo = TABLE_WRAPPERS[tag];
  if (tableInfo) {
    const t2 = document.createElement("template");
    t2.innerHTML = tableInfo.wrap + trimmed + tableInfo.unwrap;
    return () => {
      let node = t2.content.firstChild;
      for (let i = 0; i < tableInfo.depth; i++) {
        node = node.firstChild;
      }
      return node.cloneNode(true);
    };
  }
  const t = document.createElement("template");
  t.innerHTML = trimmed;
  return () => t.content.firstChild.cloneNode(true);
}
var _templateWarned = false;
function template(html) {
  if (__DEV__ && !_templateWarned) {
    _templateWarned = true;
    console.warn(
      "[what] template() is a compiler internal. Use JSX instead. Direct calls with user input can lead to XSS vulnerabilities."
    );
  }
  return _$templateImpl(html);
}
function svgTemplate(html) {
  const trimmed = html.trim();
  const tag = getLeadingTag(trimmed);
  if (tag === "svg") {
    const t2 = document.createElement("template");
    t2.innerHTML = trimmed;
    return () => t2.content.firstChild.cloneNode(true);
  }
  const t = document.createElement("template");
  t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${trimmed}</svg>`;
  return () => t.content.firstChild.firstChild.cloneNode(true);
}
function insert(parent, child, marker) {
  if (typeof child === "function") {
    let current = null;
    effect(() => {
      current = reconcileInsert(parent, child(), current, marker || null);
    });
    return current;
  }
  return reconcileInsert(parent, child, null, marker || null);
}
function isDomNode2(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof Node !== "undefined" && value instanceof Node) return true;
  return typeof value.nodeType === "number" && typeof value.nodeName === "string";
}
function isVNode2(value) {
  return !!value && typeof value === "object" && (value._vnode === true || "tag" in value);
}
function isSvgParent(parent) {
  return typeof SVGElement !== "undefined" && parent instanceof SVGElement && parent.tagName.toLowerCase() !== "foreignobject";
}
function asNodeArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
function valuesToNodes(value, parent, out) {
  if (value == null || typeof value === "boolean") return out;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      valuesToNodes(value[i], parent, out);
    }
    return out;
  }
  if (typeof value === "string" || typeof value === "number") {
    out.push(document.createTextNode(String(value)));
    return out;
  }
  if (isDomNode2(value)) {
    out.push(value);
    return out;
  }
  if (isVNode2(value)) {
    out.push(createDOM(value, parent, isSvgParent(parent)));
    return out;
  }
  out.push(document.createTextNode(String(value)));
  return out;
}
function sameNodeArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function reconcileInsert(parent, value, current, marker) {
  const targetMarker = marker || null;
  if (value == null || typeof value === "boolean") {
    const oldNodes2 = asNodeArray(current);
    for (let i = 0; i < oldNodes2.length; i++) {
      const oldNode = oldNodes2[i];
      if (oldNode.parentNode === parent) {
        disposeTree(oldNode);
        parent.removeChild(oldNode);
      }
    }
    return null;
  }
  if ((typeof value === "string" || typeof value === "number") && current && !Array.isArray(current) && current.nodeType === 3) {
    const text = String(value);
    if (current.textContent !== text) current.textContent = text;
    return current;
  }
  const newNodes = valuesToNodes(value, parent, []);
  const oldNodes = asNodeArray(current);
  if (sameNodeArray(oldNodes, newNodes)) {
    return current;
  }
  const keep = new Set(newNodes);
  for (let i = 0; i < oldNodes.length; i++) {
    const oldNode = oldNodes[i];
    if (!keep.has(oldNode) && oldNode.parentNode === parent) {
      disposeTree(oldNode);
      parent.removeChild(oldNode);
    }
  }
  let ref = targetMarker;
  for (let i = newNodes.length - 1; i >= 0; i--) {
    const node = newNodes[i];
    if (node.parentNode !== parent || node.nextSibling !== ref) {
      if (ref && ref.parentNode !== parent) ref = null;
      if (ref) parent.insertBefore(node, ref);
      else parent.appendChild(node);
    }
    ref = node;
  }
  if (newNodes.length === 0) return null;
  return newNodes.length === 1 ? newNodes[0] : newNodes;
}
function mapArray(source, mapFn, options) {
  const keyFn = options?.key;
  const raw = options?.raw || false;
  return (parent, marker) => {
    let items = [];
    let mappedNodes = [];
    let disposeFns = [];
    let keyedState = keyFn && !raw ? /* @__PURE__ */ new Map() : null;
    const endMarker = document.createComment("/list");
    parent.insertBefore(endMarker, marker || null);
    effect(() => {
      const newItems = source() || [];
      if (keyFn) {
        reconcileKeyed(parent, endMarker, items, newItems, mappedNodes, disposeFns, mapFn, keyFn, keyedState);
      } else {
        reconcileList(parent, endMarker, items, newItems, mappedNodes, disposeFns, mapFn);
      }
      items = newItems.slice();
    });
    return endMarker;
  };
}
function reconcileList(parent, endMarker, oldItems, newItems, mappedNodes, disposeFns, mapFn) {
  const newLen = newItems.length;
  const oldLen = oldItems.length;
  if (newLen === 0) {
    if (oldLen > 0) {
      for (let i = 0; i < oldLen; i++) {
        disposeFns[i]?.();
        if (mappedNodes[i]?.parentNode === parent) {
          disposeTree(mappedNodes[i]);
          parent.removeChild(mappedNodes[i]);
        }
      }
      mappedNodes.length = 0;
      disposeFns.length = 0;
    }
    return;
  }
  if (oldLen === 0) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < newLen; i++) {
      const item = newItems[i];
      const node = createRoot((dispose) => {
        disposeFns[i] = dispose;
        return mapFn(item, i);
      });
      mappedNodes[i] = node;
      frag.appendChild(node);
    }
    parent.insertBefore(frag, endMarker);
    return;
  }
  let start = 0;
  const minLen = Math.min(oldLen, newLen);
  while (start < minLen && oldItems[start] === newItems[start]) start++;
  if (start === oldLen && start === newLen) return;
  let oldEnd = oldLen - 1;
  let newEnd = newLen - 1;
  while (oldEnd >= start && newEnd >= start && oldItems[oldEnd] === newItems[newEnd]) {
    oldEnd--;
    newEnd--;
  }
  const newMapped = new Array(newLen);
  const newDispose = new Array(newLen);
  for (let i = 0; i < start; i++) {
    newMapped[i] = mappedNodes[i];
    newDispose[i] = disposeFns[i];
  }
  for (let i = newEnd + 1; i < newLen; i++) {
    const oldI = oldEnd + 1 + (i - newEnd - 1);
    newMapped[i] = mappedNodes[oldI];
    newDispose[i] = disposeFns[oldI];
  }
  const midNewLen = newEnd - start + 1;
  const midOldLen = oldEnd - start + 1;
  if (midNewLen === 0) {
    for (let i = start; i <= oldEnd; i++) {
      disposeFns[i]?.();
      if (mappedNodes[i]?.parentNode) mappedNodes[i].parentNode.removeChild(mappedNodes[i]);
    }
  } else if (midOldLen === 0) {
    const marker = start < newLen && newMapped[newEnd + 1] ? newMapped[newEnd + 1] : endMarker;
    const frag = document.createDocumentFragment();
    for (let i = start; i <= newEnd; i++) {
      const item = newItems[i];
      const idx = i;
      newMapped[i] = createRoot((dispose) => {
        newDispose[idx] = dispose;
        return mapFn(item, idx);
      });
      frag.appendChild(newMapped[i]);
    }
    parent.insertBefore(frag, marker);
  } else {
    _reconcileMiddle(
      parent,
      endMarker,
      oldItems,
      newItems,
      mappedNodes,
      disposeFns,
      mapFn,
      start,
      oldEnd,
      newEnd,
      newMapped,
      newDispose
    );
  }
  mappedNodes.length = newLen;
  disposeFns.length = newLen;
  for (let i = 0; i < newLen; i++) {
    mappedNodes[i] = newMapped[i];
    disposeFns[i] = newDispose[i];
  }
}
function _reconcileMiddle(parent, endMarker, oldItems, newItems, mappedNodes, disposeFns, mapFn, start, oldEnd, newEnd, newMapped, newDispose) {
  const oldIdxMap = /* @__PURE__ */ new Map();
  for (let i = start; i <= oldEnd; i++) {
    oldIdxMap.set(oldItems[i], i);
  }
  const midLen = newEnd - start + 1;
  const oldIndices = new Int32Array(midLen);
  oldIndices.fill(-1);
  for (let i = start; i <= newEnd; i++) {
    const oldIdx = oldIdxMap.get(newItems[i]);
    if (oldIdx !== void 0) {
      oldIdxMap.delete(newItems[i]);
      newMapped[i] = mappedNodes[oldIdx];
      newDispose[i] = disposeFns[oldIdx];
      oldIndices[i - start] = oldIdx;
    }
  }
  for (const [, oldIdx] of oldIdxMap) {
    disposeFns[oldIdx]?.();
    if (mappedNodes[oldIdx]?.parentNode) mappedNodes[oldIdx].parentNode.removeChild(mappedNodes[oldIdx]);
  }
  const reusedCount = midLen - _countNeg1(oldIndices, midLen);
  const inLIS = new Uint8Array(midLen);
  if (reusedCount > 1) {
    const seq = new Int32Array(reusedCount);
    const seqToMid = new Int32Array(reusedCount);
    let k = 0;
    for (let i = 0; i < midLen; i++) {
      if (oldIndices[i] !== -1) {
        seq[k] = oldIndices[i];
        seqToMid[k] = i;
        k++;
      }
    }
    const lisResult = _lis(seq, reusedCount);
    for (let i = 0; i < lisResult.length; i++) {
      inLIS[seqToMid[lisResult[i]]] = 1;
    }
  } else if (reusedCount === 1) {
    for (let i = 0; i < midLen; i++) {
      if (oldIndices[i] !== -1) {
        inLIS[i] = 1;
        break;
      }
    }
  }
  for (let i = start; i <= newEnd; i++) {
    if (!newMapped[i]) {
      const item = newItems[i];
      const idx = i;
      newMapped[i] = createRoot((dispose) => {
        newDispose[idx] = dispose;
        return mapFn(item, idx);
      });
    }
  }
  let nextSibling = newEnd + 1 < newMapped.length && newMapped[newEnd + 1] ? newMapped[newEnd + 1] : endMarker;
  for (let i = newEnd; i >= start; i--) {
    const mi = i - start;
    if (oldIndices[mi] === -1 || !inLIS[mi]) {
      if (nextSibling && nextSibling.parentNode !== parent) nextSibling = endMarker;
      parent.insertBefore(newMapped[i], nextSibling);
    }
    nextSibling = newMapped[i];
  }
}
function _countNeg1(arr, len) {
  let c = 0;
  for (let i = 0; i < len; i++) if (arr[i] === -1) c++;
  return c;
}
function _lis(arr, len) {
  if (len === 0) return [];
  if (len === 1) return [0];
  const tails = new Int32Array(len);
  const predecessors = new Int32Array(len);
  let tailLen = 1;
  tails[0] = 0;
  predecessors[0] = -1;
  for (let i = 1; i < len; i++) {
    if (arr[i] > arr[tails[tailLen - 1]]) {
      predecessors[i] = tails[tailLen - 1];
      tails[tailLen++] = i;
    } else {
      let lo = 0, hi = tailLen - 1;
      while (lo < hi) {
        const mid = lo + hi >> 1;
        if (arr[tails[mid]] < arr[i]) lo = mid + 1;
        else hi = mid;
      }
      tails[lo] = i;
      predecessors[i] = lo > 0 ? tails[lo - 1] : -1;
    }
  }
  const result = new Array(tailLen);
  let k = tails[tailLen - 1];
  for (let i = tailLen - 1; i >= 0; i--) {
    result[i] = k;
    k = predecessors[k];
  }
  return result;
}
function reconcileKeyed(parent, endMarker, oldItems, newItems, mappedNodes, disposeFns, mapFn, keyFn, keyedState) {
  const newLen = newItems.length;
  const oldLen = oldItems.length;
  if (newLen === 0) {
    if (oldLen > 0) {
      for (let i = 0; i < oldLen; i++) {
        disposeFns[i]?.();
        if (mappedNodes[i]?.parentNode === parent) {
          disposeTree(mappedNodes[i]);
          parent.removeChild(mappedNodes[i]);
        }
      }
      mappedNodes.length = 0;
      disposeFns.length = 0;
      if (keyedState) keyedState.clear();
    }
    return;
  }
  if (oldLen === 0) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < newLen; i++) {
      const item = newItems[i];
      const idx = i;
      let accessor;
      if (keyedState) {
        const key = keyFn(item);
        const itemSig = signal(item);
        accessor = itemSig;
        keyedState.set(key, { itemSig });
      } else {
        accessor = item;
      }
      const node = createRoot((dispose) => {
        disposeFns[idx] = dispose;
        return mapFn(accessor, idx);
      });
      mappedNodes[i] = node;
      frag.appendChild(node);
    }
    parent.insertBefore(frag, endMarker);
    return;
  }
  let start = 0;
  const minLen = Math.min(oldLen, newLen);
  while (start < minLen) {
    if (oldItems[start] === newItems[start]) {
      start++;
      continue;
    }
    const oldKey = keyFn(oldItems[start]);
    const newKey = keyFn(newItems[start]);
    if (oldKey !== newKey) break;
    if (keyedState) keyedState.get(oldKey).itemSig.set(newItems[start]);
    start++;
  }
  let oldEnd = oldLen - 1;
  let newEnd = newLen - 1;
  while (oldEnd >= start && newEnd >= start) {
    if (oldItems[oldEnd] === newItems[newEnd]) {
      oldEnd--;
      newEnd--;
      continue;
    }
    const oldKey = keyFn(oldItems[oldEnd]);
    const newKey = keyFn(newItems[newEnd]);
    if (oldKey !== newKey) break;
    if (keyedState) keyedState.get(oldKey).itemSig.set(newItems[newEnd]);
    oldEnd--;
    newEnd--;
  }
  if (start > oldEnd && start > newEnd) {
    return;
  }
  const newMapped = new Array(newLen);
  const newDispose = new Array(newLen);
  for (let i = 0; i < start; i++) {
    newMapped[i] = mappedNodes[i];
    newDispose[i] = disposeFns[i];
  }
  for (let i = newEnd + 1; i < newLen; i++) {
    const oldI = oldEnd + 1 + (i - newEnd - 1);
    newMapped[i] = mappedNodes[oldI];
    newDispose[i] = disposeFns[oldI];
  }
  const midNewLen = newEnd - start + 1;
  const midOldLen = oldEnd - start + 1;
  if (midOldLen === 0) {
    const marker = newEnd + 1 < newLen && newMapped[newEnd + 1] ? newMapped[newEnd + 1] : endMarker;
    const frag = document.createDocumentFragment();
    for (let i = start; i <= newEnd; i++) {
      const item = newItems[i];
      const idx = i;
      let accessor;
      if (keyedState) {
        const key = keyFn(item);
        const itemSig = signal(item);
        accessor = itemSig;
        keyedState.set(key, { itemSig });
      } else {
        accessor = item;
      }
      newMapped[i] = createRoot((dispose) => {
        newDispose[idx] = dispose;
        return mapFn(accessor, idx);
      });
      frag.appendChild(newMapped[i]);
    }
    parent.insertBefore(frag, marker);
    _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);
    return;
  }
  if (midNewLen === 0) {
    for (let i = start; i <= oldEnd; i++) {
      disposeFns[i]?.();
      if (mappedNodes[i]?.parentNode) parent.removeChild(mappedNodes[i]);
      if (keyedState) keyedState.delete(keyFn(oldItems[i]));
    }
    _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);
    return;
  }
  const oldKeyMap = /* @__PURE__ */ new Map();
  for (let i = start; i <= oldEnd; i++) {
    oldKeyMap.set(keyFn(oldItems[i]), i);
  }
  const oldIndices = new Int32Array(midNewLen);
  oldIndices.fill(-1);
  for (let i = start; i <= newEnd; i++) {
    const key = keyFn(newItems[i]);
    const oldIdx = oldKeyMap.get(key);
    if (oldIdx !== void 0) {
      oldKeyMap.delete(key);
      newMapped[i] = mappedNodes[oldIdx];
      newDispose[i] = disposeFns[oldIdx];
      oldIndices[i - start] = oldIdx;
      if (keyedState && newItems[i] !== oldItems[oldIdx]) {
        keyedState.get(key).itemSig.set(newItems[i]);
      }
    }
  }
  for (const [key, oldIdx] of oldKeyMap) {
    disposeFns[oldIdx]?.();
    if (mappedNodes[oldIdx]?.parentNode) parent.removeChild(mappedNodes[oldIdx]);
    if (keyedState) keyedState.delete(key);
  }
  for (let i = start; i <= newEnd; i++) {
    if (!newMapped[i]) {
      const item = newItems[i];
      const idx = i;
      let accessor;
      if (keyedState) {
        const key = keyFn(item);
        const itemSig = signal(item);
        accessor = itemSig;
        keyedState.set(key, { itemSig });
      } else {
        accessor = item;
      }
      newMapped[i] = createRoot((dispose) => {
        newDispose[idx] = dispose;
        return mapFn(accessor, idx);
      });
    }
  }
  let reusedCount = 0;
  let alreadySorted = true;
  let lastOldIdx = -1;
  for (let i = 0; i < midNewLen; i++) {
    if (oldIndices[i] !== -1) {
      reusedCount++;
      if (oldIndices[i] <= lastOldIdx) alreadySorted = false;
      lastOldIdx = oldIndices[i];
    }
  }
  const inLIS = new Uint8Array(midNewLen);
  if (alreadySorted) {
    for (let i = 0; i < midNewLen; i++) {
      if (oldIndices[i] !== -1) inLIS[i] = 1;
    }
  } else if (reusedCount > 1) {
    const seq = new Int32Array(reusedCount);
    const seqToMid = new Int32Array(reusedCount);
    let k = 0;
    for (let i = 0; i < midNewLen; i++) {
      if (oldIndices[i] !== -1) {
        seq[k] = oldIndices[i];
        seqToMid[k] = i;
        k++;
      }
    }
    const lisResult = _lis(seq, reusedCount);
    for (let i = 0; i < lisResult.length; i++) {
      inLIS[seqToMid[lisResult[i]]] = 1;
    }
  } else if (reusedCount === 1) {
    for (let i = 0; i < midNewLen; i++) {
      if (oldIndices[i] !== -1) {
        inLIS[i] = 1;
        break;
      }
    }
  }
  let nextSibling = newEnd + 1 < newMapped.length && newMapped[newEnd + 1] ? newMapped[newEnd + 1] : endMarker;
  for (let i = newEnd; i >= start; i--) {
    const mi = i - start;
    if (oldIndices[mi] === -1 || !inLIS[mi]) {
      if (nextSibling && nextSibling.parentNode !== parent) nextSibling = endMarker;
      parent.insertBefore(newMapped[i], nextSibling);
    }
    nextSibling = newMapped[i];
  }
  _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);
}
function _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen) {
  mappedNodes.length = newLen;
  disposeFns.length = newLen;
  for (let i = 0; i < newLen; i++) {
    mappedNodes[i] = newMapped[i];
    disposeFns[i] = newDispose[i];
  }
}
function spread(el, props) {
  for (const key in props) {
    const value = props[key];
    if (key.startsWith("on") && key.length > 2) {
      const event = key.slice(2).toLowerCase();
      el.addEventListener(event, value);
      continue;
    }
    if (typeof value === "function" && !key.startsWith("on")) {
      if (key === "class" || key === "className") {
        effect(() => {
          el.className = value() || "";
        });
      } else if (key === "style" && typeof value() === "object") {
        effect(() => {
          const styles = value();
          for (const prop in styles) {
            el.style[prop] = styles[prop] ?? "";
          }
        });
      } else {
        effect(() => {
          setProp2(el, key, value());
        });
      }
    } else {
      setProp2(el, key, value);
    }
  }
}
function setProp2(el, key, value) {
  if (URL_ATTRS.has(key) || URL_ATTRS.has(key.toLowerCase())) {
    if (!isSafeUrl(value)) {
      if (typeof console !== "undefined") {
        console.warn(`[what] Blocked unsafe URL in "${key}" attribute: ${value}`);
      }
      return;
    }
  }
  if (key === "class" || key === "className") {
    el.className = value || "";
  } else if (key === "dangerouslySetInnerHTML") {
    el.innerHTML = value?.__html ?? "";
  } else if (key === "innerHTML") {
    if (value && typeof value === "object" && "__html" in value) {
      el.innerHTML = value.__html ?? "";
    } else {
      if (typeof console !== "undefined" && value != null && value !== "") {
        console.warn(
          '[what] Plain string innerHTML is not allowed. Use { __html: "..." } or dangerouslySetInnerHTML={{ __html: "..." }} instead.'
        );
      }
    }
  } else if (key === "style") {
    if (typeof value === "string") {
      el.style.cssText = value;
    } else if (typeof value === "object") {
      for (const prop in value) {
        el.style[prop] = value[prop] ?? "";
      }
    }
  } else if (key.startsWith("data-") || key.startsWith("aria-")) {
    el.setAttribute(key, value);
  } else if (typeof value === "boolean") {
    if (value) el.setAttribute(key, "");
    else el.removeAttribute(key);
  } else if (key in el) {
    el[key] = value;
  } else {
    el.setAttribute(key, value);
  }
}
var delegatedEvents = /* @__PURE__ */ new Set();
function delegateEvents(eventNames) {
  for (const name of eventNames) {
    if (delegatedEvents.has(name)) continue;
    delegatedEvents.add(name);
    document.addEventListener(name, (e) => {
      let node = e.target;
      const key = "$$" + name;
      while (node) {
        const handler = node[key];
        if (handler) {
          handler(e);
          if (e.cancelBubble) return;
        }
        node = node.parentNode;
      }
    });
  }
}
function on(el, event, handler) {
  el.addEventListener(event, handler);
  return () => el.removeEventListener(event, handler);
}
function classList(el, classes) {
  effect(() => {
    for (const name in classes) {
      const value = typeof classes[name] === "function" ? classes[name]() : classes[name];
      el.classList.toggle(name, !!value);
    }
  });
}
var _isHydrating = false;
var _hydrationCursor = null;
function isHydrating() {
  return _isHydrating;
}
function hydrate(vnode, container) {
  _isHydrating = true;
  _hydrationCursor = { parent: container, index: 0 };
  try {
    const result = hydrateNode(vnode, container);
    return result;
  } finally {
    _isHydrating = false;
    _hydrationCursor = null;
  }
}
function claimNode(parent) {
  const children = parent.childNodes;
  while (_hydrationCursor.index < children.length) {
    const node = children[_hydrationCursor.index];
    if (node.nodeType === 8) {
      const text = node.textContent;
      if (text === "$" || text === "/$" || text === "[]" || text === "/[]") {
        _hydrationCursor.index++;
        continue;
      }
    }
    _hydrationCursor.index++;
    return node;
  }
  return null;
}
function isDevMode() {
  return typeof process !== "undefined" && true;
}
function hydrateNode(vnode, parent) {
  if (vnode == null || typeof vnode === "boolean") {
    return null;
  }
  if (typeof vnode === "string" || typeof vnode === "number") {
    const existing = claimNode(parent);
    const text = String(vnode);
    if (existing && existing.nodeType === 3) {
      if (isDevMode() && existing.textContent !== text) {
        console.warn(
          `[what] Hydration mismatch: expected text "${text}", got "${existing.textContent}"`
        );
        existing.textContent = text;
      }
      return existing;
    }
    if (isDevMode()) {
      console.warn(
        `[what] Hydration mismatch: expected text node "${text}", got ${existing ? existing.nodeName : "nothing"}. Falling back to client render.`
      );
    }
    const textNode2 = document.createTextNode(text);
    if (existing) {
      parent.replaceChild(textNode2, existing);
    } else {
      parent.appendChild(textNode2);
    }
    return textNode2;
  }
  if (typeof vnode === "function") {
    const initialValue = vnode();
    let current = hydrateNode(initialValue, parent);
    effect(() => {
      const value = vnode();
      if (!_isHydrating) {
        current = reconcileInsert(parent, value, current, null);
      }
    });
    return current;
  }
  if (Array.isArray(vnode)) {
    const nodes = [];
    for (const child of vnode) {
      const node = hydrateNode(child, parent);
      if (node) nodes.push(node);
    }
    return nodes.length === 1 ? nodes[0] : nodes;
  }
  if (typeof vnode === "object" && vnode._vnode) {
    if (typeof vnode.tag === "function") {
      const componentStack2 = getComponentStack();
      const Component = vnode.tag;
      const props = vnode.props || {};
      const children = vnode.children || [];
      const ctx = {
        hooks: [],
        hookIndex: 0,
        effects: [],
        cleanups: [],
        mounted: false,
        disposed: false,
        Component,
        _parentCtx: componentStack2[componentStack2.length - 1] || null,
        _errorBoundary: null
      };
      componentStack2.push(ctx);
      let result;
      try {
        const propsChildren = children.length === 0 ? void 0 : children.length === 1 ? children[0] : children;
        result = Component({ ...props, children: propsChildren });
      } catch (error) {
        componentStack2.pop();
        console.error("[what] Error in component during hydration:", Component.name || "Anonymous", error);
        return null;
      }
      componentStack2.pop();
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
      return hydrateNode(result, parent);
    }
    const existing = claimNode(parent);
    const expectedTag = vnode.tag.toUpperCase();
    if (existing && existing.nodeType === 1 && existing.nodeName === expectedTag) {
      hydrateElementProps(existing, vnode.props || {});
      const savedCursor = _hydrationCursor;
      _hydrationCursor = { parent: existing, index: 0 };
      const rawInner = vnode.props?.dangerouslySetInnerHTML?.__html;
      if (rawInner == null) {
        for (const child of vnode.children) {
          hydrateNode(child, existing);
        }
      }
      _hydrationCursor = savedCursor;
      return existing;
    }
    if (isDevMode()) {
      console.warn(
        `[what] Hydration mismatch: expected <${vnode.tag}>, got ${existing ? existing.nodeName : "nothing"}. Falling back to client render.`
      );
    }
    const newEl = document.createElement(vnode.tag);
    for (const key in vnode.props || {}) {
      if (key === "children" || key === "key") continue;
      setProp2(newEl, key, vnode.props[key]);
    }
    for (const child of vnode.children) {
      reconcileInsert(newEl, child, null, null);
    }
    if (existing) {
      parent.replaceChild(newEl, existing);
    } else {
      parent.appendChild(newEl);
    }
    return newEl;
  }
  if (isDomNode2(vnode)) {
    return vnode;
  }
  const textNode = document.createTextNode(String(vnode));
  parent.appendChild(textNode);
  return textNode;
}
function hydrateElementProps(el, props) {
  for (const key in props) {
    if (key === "children" || key === "key" || key === "ref") continue;
    if (key === "dangerouslySetInnerHTML" || key === "innerHTML") continue;
    const value = props[key];
    if (key.startsWith("on") && key.length > 2) {
      const event = key.slice(2).toLowerCase();
      el.addEventListener(event, value);
      continue;
    }
    if (key.startsWith("$$")) {
      el[key] = value;
      continue;
    }
    if (typeof value === "function" && !key.startsWith("on")) {
      if (key === "class" || key === "className") {
        effect(() => {
          el.className = value() || "";
        });
      } else if (key === "style" && typeof value() === "object") {
        effect(() => {
          const styles = value();
          for (const prop in styles) {
            el.style[prop] = styles[prop] ?? "";
          }
        });
      } else {
        effect(() => {
          setProp2(el, key, value());
        });
      }
      continue;
    }
    if (key === "data-hk") continue;
  }
}
export {
  _$createComponent,
  _$templateImpl as _$template,
  template as _template,
  classList,
  delegateEvents,
  effect,
  hydrate,
  insert,
  isHydrating,
  mapArray,
  on,
  setProp2 as setProp,
  spread,
  svgTemplate,
  template,
  untrack
};
//# sourceMappingURL=render.js.map
