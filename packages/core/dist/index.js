// packages/core/src/reactive.js
var __DEV__ = typeof process !== "undefined" ? true : true;
var __devtools = null;
function __setDevToolsHooks(hooks) {
  if (__DEV__) __devtools = hooks;
}
var currentEffect = null;
var currentRoot = null;
var currentOwner = null;
var insideComputed = false;
var batchDepth = 0;
var pendingEffects = [];
var pendingNeedSort = false;
var subSetOwner = /* @__PURE__ */ new WeakMap();
var NEEDS_UPSTREAM = /* @__PURE__ */ Symbol("needs_upstream");
var iterativeEvalStack = null;
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
function computed(fn) {
  let value, dirty = true;
  const subs = /* @__PURE__ */ new Set();
  const inner = _createEffect(() => {
    const prevInsideComputed = insideComputed;
    if (__DEV__) insideComputed = true;
    try {
      value = fn();
      dirty = false;
    } finally {
      if (__DEV__) insideComputed = prevInsideComputed;
    }
  }, true);
  inner._level = 1;
  inner._computed = true;
  inner._computedSubs = subs;
  subSetOwner.set(subs, inner);
  inner._markDirty = () => {
    dirty = true;
  };
  inner._isDirty = () => dirty;
  function read() {
    if (currentEffect) {
      subs.add(currentEffect);
      currentEffect.deps.push(subs);
    }
    if (dirty) _evaluateComputed(inner);
    return value;
  }
  inner._onNotify = () => {
    dirty = true;
    if (subs.size > 0) notify(subs);
  };
  read._signal = true;
  read.peek = () => {
    if (dirty) _evaluateComputed(inner);
    return value;
  };
  return read;
}
function _evaluateComputed(computedEffect) {
  if (iterativeEvalStack !== null) {
    iterativeEvalStack.push(computedEffect);
    throw NEEDS_UPSTREAM;
  }
  const stack = [computedEffect];
  iterativeEvalStack = stack;
  try {
    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      if (!current._isDirty || !current._isDirty()) {
        stack.pop();
        continue;
      }
      let pushedUpstream = false;
      const deps = current.deps;
      for (let i = 0; i < deps.length; i++) {
        const depOwner = subSetOwner.get(deps[i]);
        if (depOwner && depOwner._computed && depOwner._isDirty && depOwner._isDirty()) {
          stack.push(depOwner);
          pushedUpstream = true;
        }
      }
      if (pushedUpstream) {
        continue;
      }
      try {
        const prevDepsLen = current.deps.length;
        _runEffect(current);
        if (current.deps.length !== prevDepsLen) {
          _updateLevel(current);
        }
        stack.pop();
      } catch (err) {
        if (err === NEEDS_UPSTREAM) {
          current._markDirty();
        } else {
          throw err;
        }
      }
    }
  } finally {
    iterativeEvalStack = null;
  }
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
function batch(fn) {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}
function _createEffect(fn, lazy2) {
  const e = {
    fn,
    deps: [],
    // array of subscriber sets (cheaper than Set for typical 1-3 deps)
    lazy: lazy2 || false,
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
var isFlushing = false;
function flush() {
  if (isFlushing) return;
  isFlushing = true;
  try {
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
      for (let i = 0; i < pendingEffects.length; i++) pendingEffects[i]._pending = false;
      pendingEffects.length = 0;
      if (__DEV__) {
        const remaining = pendingEffects.slice(0, 3);
        const effectNames = remaining.map((e) => e.fn?.name || e.fn?.toString().slice(0, 60) || "(anonymous)");
        console.warn(
          `[what] Possible infinite effect loop detected (25 iterations). Likely cause: an effect writes to a signal it also reads, creating a cycle. Use untrack() to read signals without subscribing. Looping effects: ${effectNames.join(", ")}`
        );
      } else {
        console.warn("[what] Possible infinite effect loop detected");
      }
    }
  } finally {
    isFlushing = false;
  }
}
function memo(fn) {
  let value;
  const subs = /* @__PURE__ */ new Set();
  const e = _createEffect(() => {
    const next = fn();
    if (!Object.is(value, next)) {
      value = next;
      for (const sub of subs) {
        if (sub.disposed) continue;
        if (sub._onNotify) {
          sub._onNotify();
        } else if (!sub._pending) {
          sub._pending = true;
          const level = sub._level;
          const len = pendingEffects.length;
          if (len > 0 && pendingEffects[len - 1]._level > level) {
            pendingNeedSort = true;
          }
          pendingEffects.push(sub);
        }
      }
    }
  });
  e._level = 1;
  _runEffect(e);
  _updateLevel(e);
  subSetOwner.set(subs, e);
  if (currentRoot) {
    currentRoot.disposals.push(() => _disposeEffect(e));
  }
  function read() {
    if (currentEffect) {
      subs.add(currentEffect);
      currentEffect.deps.push(subs);
    }
    return value;
  }
  read._signal = true;
  read.peek = () => value;
  return read;
}
function flushSync() {
  if (isFlushing) {
    if (__DEV__) {
      console.warn(
        "[what] flushSync() called during an active flush (e.g., inside a component render or effect). This is a no-op to prevent infinite loops. Move flushSync() to an event handler or onMount callback."
      );
    }
    return;
  }
  if (currentEffect) {
    if (__DEV__) {
      console.warn(
        "[what] flushSync() called during effect execution. This is a no-op to prevent infinite loops. Move flushSync() to an event handler or onMount callback."
      );
    }
    return;
  }
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
function getOwner() {
  return currentOwner;
}
function runWithOwner(owner, fn) {
  const prev = currentOwner;
  const prevRoot = currentRoot;
  currentOwner = owner;
  currentRoot = owner;
  try {
    return fn();
  } finally {
    currentOwner = prev;
    currentRoot = prevRoot;
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
function onCleanup(fn) {
  if (currentRoot) {
    currentRoot.disposals.push(fn);
  }
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
function Fragment({ children }) {
  return children;
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
function html(strings, ...values) {
  const src = strings.reduce((acc, str, i) => acc + str + (i < values.length ? `\0${i}\0` : ""), "");
  return parseTemplate(src, values);
}
function parseTemplate(src, values) {
  src = src.trim();
  const nodes = [];
  let i = 0;
  while (i < src.length) {
    if (src[i] === "<") {
      const result2 = parseElement(src, i, values);
      if (result2) {
        nodes.push(result2.node);
        i = result2.end;
        continue;
      }
    }
    const result = parseText(src, i, values);
    if (result.text) nodes.push(result.text);
    i = result.end;
  }
  return nodes.length === 1 ? nodes[0] : nodes;
}
function parseElement(src, start, values) {
  const openMatch = src.slice(start).match(/^<([a-zA-Z][a-zA-Z0-9-]*|[A-Z]\w*)/);
  if (!openMatch) return null;
  const tag = openMatch[1];
  let i = start + openMatch[0].length;
  const props = {};
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.slice(i, i + 2) === "/>") {
      return { node: h(tag, Object.keys(props).length ? props : null), end: i + 2 };
    }
    if (src[i] === ">") {
      i++;
      break;
    }
    if (src.slice(i, i + 3) === "...") {
      const placeholder = src.slice(i + 3).match(/^\x00(\d+)\x00/);
      if (placeholder) {
        Object.assign(props, values[Number(placeholder[1])]);
        i += 3 + placeholder[0].length;
        continue;
      }
    }
    const attrMatch = src.slice(i).match(/^([a-zA-Z_@:][a-zA-Z0-9_:.-]*)/);
    if (!attrMatch) break;
    const attrName = attrMatch[1];
    i += attrMatch[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === "=") {
      i++;
      while (i < src.length && /\s/.test(src[i])) i++;
      const ph = src.slice(i).match(/^\x00(\d+)\x00/);
      if (ph) {
        props[attrName] = values[Number(ph[1])];
        i += ph[0].length;
      } else if (src[i] === '"' || src[i] === "'") {
        const q = src[i];
        i++;
        let val = "";
        while (i < src.length && src[i] !== q) {
          const tph = src.slice(i).match(/^\x00(\d+)\x00/);
          if (tph) {
            val += String(values[Number(tph[1])]);
            i += tph[0].length;
          } else {
            val += src[i];
            i++;
          }
        }
        i++;
        props[attrName] = val;
      }
    } else {
      props[attrName] = true;
    }
  }
  const children = [];
  const closeTag = `</${tag}>`;
  while (i < src.length) {
    if (src.slice(i, i + closeTag.length) === closeTag) {
      i += closeTag.length;
      break;
    }
    if (src[i] === "<") {
      const child = parseElement(src, i, values);
      if (child) {
        children.push(child.node);
        i = child.end;
        continue;
      }
    }
    const text = parseText(src, i, values);
    if (text.text != null) children.push(text.text);
    i = text.end;
  }
  return {
    node: h(tag, Object.keys(props).length ? props : null, ...children),
    end: i
  };
}
function parseText(src, start, values) {
  let i = start;
  let text = "";
  while (i < src.length && src[i] !== "<") {
    const ph = src.slice(i).match(/^\x00(\d+)\x00/);
    if (ph) {
      if (text.trim()) {
        return { text: text.trim(), end: i };
      }
      return { text: values[Number(ph[1])], end: i + ph[0].length };
    }
    text += src[i];
    i++;
  }
  return { text: text.trim() || null, end: i };
}

// packages/core/src/components.js
function memo2(Component, _areEqual) {
  const MemoWrapper = function MemoWrapper2(props) {
    return Component(props);
  };
  MemoWrapper.displayName = `Memo(${Component.name || "Anonymous"})`;
  return MemoWrapper;
}
var _getCurrentComponent = null;
function _injectGetCurrentComponent(fn) {
  _getCurrentComponent = fn;
}
function lazy(loader) {
  let Component = null;
  let loadPromise = null;
  let loadError = null;
  const listeners = /* @__PURE__ */ new Set();
  function LazyWrapper(props) {
    if (loadError) throw loadError;
    if (Component) return h(Component, props);
    if (!loadPromise) {
      loadPromise = loader().then((mod) => {
        Component = mod.default || mod;
        listeners.forEach((fn) => fn());
        listeners.clear();
      }).catch((err) => {
        loadError = err;
      });
    }
    throw loadPromise;
  }
  LazyWrapper.displayName = "Lazy";
  LazyWrapper._lazy = true;
  LazyWrapper._onLoad = (fn) => {
    if (Component) fn();
    else listeners.add(fn);
  };
  return LazyWrapper;
}
function Suspense({ fallback, children }) {
  const loading = signal(false);
  const pendingPromises = /* @__PURE__ */ new Set();
  const boundary = {
    _suspense: true,
    onSuspend(promise) {
      loading.set(true);
      pendingPromises.add(promise);
      promise.finally(() => {
        pendingPromises.delete(promise);
        if (pendingPromises.size === 0) {
          loading.set(false);
        }
      });
    }
  };
  return {
    tag: "__suspense",
    props: { boundary, fallback, loading },
    children: Array.isArray(children) ? children : [children],
    _vnode: true
  };
}
function ErrorBoundary({ fallback, children, onError }) {
  const errorState = signal(null);
  const handleError = (error) => {
    errorState.set(error);
    if (onError) {
      try {
        onError(error);
      } catch (e) {
        console.error("Error in onError handler:", e);
      }
    }
  };
  const reset = () => errorState.set(null);
  return {
    tag: "__errorBoundary",
    props: { errorState, handleError, fallback, reset },
    children: Array.isArray(children) ? children : [children],
    _vnode: true
  };
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
function Show({ when, fallback = null, children }) {
  const condition = typeof when === "function" ? when() : when;
  return condition ? children : fallback;
}
function For({ each: each2, fallback = null, children }) {
  const list = typeof each2 === "function" ? each2() : each2;
  if (!list || list.length === 0) return fallback;
  const renderFn = Array.isArray(children) ? children[0] : children;
  if (typeof renderFn !== "function") {
    console.warn("[what] For: children must be a render function, e.g. <For each={items}>{(item) => ...}</For>");
    return fallback;
  }
  return list.map((item, index) => {
    const vnode = renderFn(item, index);
    if (vnode && typeof vnode === "object" && vnode.key == null) {
      if (item != null && typeof item === "object") {
        if (item.id != null) vnode.key = item.id;
        else if (item.key != null) vnode.key = item.key;
      } else if (typeof item === "string" || typeof item === "number") {
        vnode.key = item;
      }
    }
    return vnode;
  });
}
function Switch({ fallback = null, children }) {
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child && child.tag === Match) {
      const condition = typeof child.props.when === "function" ? child.props.when() : child.props.when;
      if (condition) {
        return child.children;
      }
    }
  }
  return fallback;
}
function Match({ when, children }) {
  return { tag: Match, props: { when }, children, _vnode: true };
}
function Island({ component: Component, mode, mediaQuery, ...props }) {
  const placeholder = h("div", { "data-island": Component.name || "Island", "data-hydrate": mode });
  const wrapper = signal(null);
  const hydrated = signal(false);
  function doHydrate() {
    if (hydrated()) return;
    hydrated.set(true);
    wrapper.set(h(Component, props));
  }
  function scheduleHydration(el) {
    switch (mode) {
      case "load":
        queueMicrotask(doHydrate);
        break;
      case "idle":
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(doHydrate);
        } else {
          setTimeout(doHydrate, 200);
        }
        break;
      case "visible": {
        const observer = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) {
            observer.disconnect();
            doHydrate();
          }
        });
        observer.observe(el);
        break;
      }
      case "interaction": {
        const hydrate2 = () => {
          el.removeEventListener("click", hydrate2);
          el.removeEventListener("focus", hydrate2);
          el.removeEventListener("mouseenter", hydrate2);
          doHydrate();
        };
        el.addEventListener("click", hydrate2, { once: true });
        el.addEventListener("focus", hydrate2, { once: true });
        el.addEventListener("mouseenter", hydrate2, { once: true });
        break;
      }
      case "media": {
        if (!mediaQuery) {
          doHydrate();
          break;
        }
        const mq = window.matchMedia(mediaQuery);
        if (mq.matches) {
          queueMicrotask(doHydrate);
        } else {
          const checkMedia = () => {
            if (mq.matches) {
              mq.removeEventListener("change", checkMedia);
              doHydrate();
            }
          };
          mq.addEventListener("change", checkMedia);
        }
        break;
      }
      default:
        queueMicrotask(doHydrate);
    }
  }
  const refCallback = (el) => {
    if (el) scheduleHydration(el);
  };
  return h(
    "div",
    { "data-island": Component.name || "Island", "data-hydrate": mode, ref: refCallback },
    hydrated() ? wrapper() : null
  );
}

// packages/core/src/helpers.js
var _eachWarned = false;
function each(list, fn, keyFn) {
  if (!_eachWarned) {
    _eachWarned = true;
    console.warn("[what] each() is deprecated. Use the <For> component or Array.map() instead.");
  }
  if (!list || list.length === 0) return [];
  return list.map((item, index) => {
    const vnode = fn(item, index);
    if (keyFn && vnode && typeof vnode === "object") {
      vnode.key = keyFn(item, index);
    }
    return vnode;
  });
}
function cls(...args) {
  const classes = [];
  for (const arg of args) {
    if (!arg) continue;
    if (typeof arg === "string") {
      classes.push(arg);
    } else if (typeof arg === "object") {
      for (const [key, val] of Object.entries(arg)) {
        if (val) classes.push(key);
      }
    }
  }
  return classes.join(" ");
}
function style(obj) {
  if (typeof obj === "string") return obj;
  return Object.entries(obj).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${camelToKebab(k)}:${v}`).join(";");
}
function camelToKebab(str) {
  return str.replace(/([A-Z])/g, "-$1").toLowerCase();
}
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}
var _getCurrentComponentRef = null;
function _setComponentRef(fn) {
  _getCurrentComponentRef = fn;
}
function useMediaQuery(query) {
  if (typeof window === "undefined") return signal(false);
  const mq = window.matchMedia(query);
  const s = signal(mq.matches);
  const handler = (e) => s.set(e.matches);
  mq.addEventListener("change", handler);
  const ctx = _getCurrentComponentRef?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => mq.removeEventListener("change", handler));
  }
  return s;
}
function useLocalStorage(key, initial) {
  let stored;
  try {
    const raw = localStorage.getItem(key);
    stored = raw !== null ? JSON.parse(raw) : initial;
  } catch {
    stored = initial;
  }
  const s = signal(stored);
  const dispose = effect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(s()));
    } catch (e) {
      if (__DEV__) console.warn("[what] localStorage write failed (quota exceeded?):", e);
    }
  });
  let storageHandler = null;
  if (typeof window !== "undefined") {
    storageHandler = (e) => {
      if (e.key === key && e.newValue !== null) {
        try {
          s.set(JSON.parse(e.newValue));
        } catch (err) {
          if (__DEV__) console.warn("[what] localStorage parse failed:", err);
        }
      }
    };
    window.addEventListener("storage", storageHandler);
  }
  const ctx = _getCurrentComponentRef?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => {
      dispose();
      if (storageHandler) window.removeEventListener("storage", storageHandler);
    });
  }
  return s;
}
function Portal({ target, children }) {
  if (typeof document === "undefined") return null;
  const container = typeof target === "string" ? document.querySelector(target) : target;
  if (!container) return null;
  return { tag: "__portal", props: { container }, children: Array.isArray(children) ? children : [children], _vnode: true };
}
function useClickOutside(ref, handler) {
  if (typeof document === "undefined") return;
  const listener = (e) => {
    const el = ref.current || ref;
    if (!el || el.contains(e.target)) return;
    handler(e);
  };
  document.addEventListener("mousedown", listener);
  document.addEventListener("touchstart", listener);
  const ctx = _getCurrentComponentRef?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    });
  }
}
function transition(name, active) {
  return {
    class: active ? `${name}-enter ${name}-enter-active` : `${name}-leave ${name}-leave-active`
  };
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
function mount(vnode, container) {
  if (typeof container === "string") {
    container = document.querySelector(container);
  }
  disposeTree(container);
  container.textContent = "";
  const node = createDOM(vnode, container);
  if (node) container.appendChild(node);
  return () => {
    disposeTree(container);
    container.textContent = "";
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
  const startComment = document.createComment("eb:start");
  const endComment = document.createComment("eb:end");
  const boundaryCtx = {
    hooks: [],
    hookIndex: 0,
    effects: [],
    cleanups: [],
    mounted: false,
    disposed: false,
    _parentCtx: componentStack[componentStack.length - 1] || null,
    _errorBoundary: handleError,
    _startComment: startComment,
    _endComment: endComment
  };
  _commentCtxMap.set(startComment, boundaryCtx);
  const container = document.createDocumentFragment();
  container._componentCtx = boundaryCtx;
  container.appendChild(startComment);
  container.appendChild(endComment);
  const dispose = effect(() => {
    const error = errorState();
    componentStack.push(boundaryCtx);
    if (startComment.parentNode) {
      while (startComment.nextSibling && startComment.nextSibling !== endComment) {
        const old = startComment.nextSibling;
        disposeTree(old);
        old.parentNode.removeChild(old);
      }
    }
    let vnodes;
    if (error) {
      vnodes = typeof fallback === "function" ? [fallback({ error, reset })] : [fallback];
    } else {
      vnodes = children;
    }
    vnodes = Array.isArray(vnodes) ? vnodes : [vnodes];
    for (const v of vnodes) {
      const node = createDOM(v, parent);
      if (node) {
        if (endComment.parentNode) {
          endComment.parentNode.insertBefore(node, endComment);
        } else {
          container.insertBefore(node, endComment);
        }
      }
    }
    componentStack.pop();
  });
  boundaryCtx.effects.push(dispose);
  return container;
}
function createSuspenseBoundary(vnode, parent) {
  const { boundary, fallback, loading } = vnode.props;
  const children = vnode.children;
  const startComment = document.createComment("sb:start");
  const endComment = document.createComment("sb:end");
  const boundaryCtx = {
    hooks: [],
    hookIndex: 0,
    effects: [],
    cleanups: [],
    mounted: false,
    disposed: false,
    _parentCtx: componentStack[componentStack.length - 1] || null,
    _startComment: startComment,
    _endComment: endComment
  };
  _commentCtxMap.set(startComment, boundaryCtx);
  const container = document.createDocumentFragment();
  container._componentCtx = boundaryCtx;
  container.appendChild(startComment);
  container.appendChild(endComment);
  const dispose = effect(() => {
    const isLoading = loading();
    const vnodes = isLoading ? [fallback] : children;
    const normalized = Array.isArray(vnodes) ? vnodes : [vnodes];
    componentStack.push(boundaryCtx);
    if (startComment.parentNode) {
      while (startComment.nextSibling && startComment.nextSibling !== endComment) {
        const old = startComment.nextSibling;
        disposeTree(old);
        old.parentNode.removeChild(old);
      }
    }
    for (const v of normalized) {
      const node = createDOM(v, parent);
      if (node) {
        if (endComment.parentNode) {
          endComment.parentNode.insertBefore(node, endComment);
        } else {
          container.insertBefore(node, endComment);
        }
      }
    }
    componentStack.pop();
  });
  boundaryCtx.effects.push(dispose);
  return container;
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
function getLeadingTag(html2) {
  const m = html2.match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
  return m ? m[1] : "";
}
function _$templateImpl(html2) {
  const trimmed = html2.trim();
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
function template(html2) {
  if (__DEV__ && !_templateWarned) {
    _templateWarned = true;
    console.warn(
      "[what] template() is a compiler internal. Use JSX instead. Direct calls with user input can lead to XSS vulnerabilities."
    );
  }
  return _$templateImpl(html2);
}
function svgTemplate(html2) {
  const trimmed = html2.trim();
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
  if (!parent || typeof parent.insertBefore !== "function") {
    if (__DEV__) {
      console.warn("[what] reconcileInsert called with invalid parent:", parent);
    }
    return current;
  }
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
  if (key === "ref") {
    if (typeof value === "function") value(el);
    else if (value && typeof value === "object") value.current = el;
    return;
  }
  if (key === "key") return;
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

// packages/core/src/hooks.js
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
  const data = signal(options.initialValue ?? null);
  const loading = signal(!options.initialValue);
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
  if (!options.initialValue) {
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
        fn.apply(proxy, args);
      });
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
  if (typeof document === "undefined") return null;
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
  effectCycleDetection: true,
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
  const originalToString = signalFn.toString;
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
var VERSION = "0.6.0";
var mountedComponents2 = [];
function registerComponent(component) {
  if (!__DEV__) return;
  mountedComponents2.push(component);
}
function unregisterComponent(component) {
  if (!__DEV__) return;
  const idx = mountedComponents2.indexOf(component);
  if (idx >= 0) mountedComponents2.splice(idx, 1);
}
function getMountedComponents() {
  return mountedComponents2.slice();
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
    totalComponents: mountedComponents2.length
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
  __getCacheSnapshot,
  __setDevToolsHooks,
  template as _template,
  announce,
  announceAssertive,
  atom,
  batch,
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
  flushScheduler,
  flushSync,
  getActiveSignals,
  getCollectedErrors,
  getGuardrailConfig,
  getHealth,
  getMountedComponents,
  getOwner,
  getQueryData,
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
  scheduleRead,
  scheduleWrite,
  setProp2 as setProp,
  setQueryData,
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
