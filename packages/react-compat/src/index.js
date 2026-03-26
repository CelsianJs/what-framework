/**
 * what-react — React compatibility layer for What Framework
 *
 * Implements React's public API using What's signals + reconciler.
 * Alias "react" → "what-react" in your bundler to use React libraries.
 *
 * What's existing hooks already have positional tracking (hookIndex/hooks[]),
 * so most hooks are thin re-exports. The main work is bridging createElement,
 * forwardRef, Children, class components, and React-specific APIs.
 */

import {
  h,
  Fragment as WhatFragment,
  signal,
  effect,
  computed,
  batch,
  flushSync as whatFlushSync,
  untrack,
  memo as whatMemo,
  lazy as whatLazy,
  Suspense as WhatSuspense,
  ErrorBoundary as WhatErrorBoundary,
  useState as whatUseState,
  useEffect as whatUseEffect,
  useMemo as whatUseMemo,
  useCallback as whatUseCallback,
  useRef as whatUseRef,
  useContext as whatUseContext,
  useReducer as whatUseReducer,
  createContext as whatCreateContext,
  onMount,
  onCleanup,
} from 'what-core';

// ---- Re-export What's hooks with React-compatible names ----

export const useState = whatUseState;
export const useEffect = whatUseEffect;
export const useMemo = whatUseMemo;
export const useCallback = whatUseCallback;
export const useRef = whatUseRef;
export const useContext = whatUseContext;
export const useReducer = whatUseReducer;
export const createContext = whatCreateContext;
export const Fragment = WhatFragment;
export const Suspense = WhatSuspense;
export const memo = whatMemo;
export const lazy = whatLazy;

// ---- Class component wrapper ----

const classWrapperCache = new WeakMap();

function isClassComponent(type) {
  return (
    typeof type === 'function' &&
    (type.prototype?.isReactComponent || type.prototype?.render)
  );
}

// Max re-renders per component per frame to prevent infinite loops
const MAX_RENDERS_PER_FRAME = 50;

function getClassWrapper(ClassComp) {
  let wrapper = classWrapperCache.get(ClassComp);
  if (wrapper) return wrapper;

  wrapper = function ClassComponentWrapper(props) {
    const instanceRef = whatUseRef(null);
    const [renderCount, forceRender] = whatUseState(0);
    const renderGuardRef = whatUseRef({ count: 0, frame: 0 });

    // Render cycle guard — prevent infinite re-render loops
    const currentFrame = renderGuardRef.current.frame;
    if (typeof requestAnimationFrame !== 'undefined') {
      renderGuardRef.current.count++;
      if (renderGuardRef.current.count > MAX_RENDERS_PER_FRAME) {
        console.error(`[what-react] Max re-renders exceeded for ${ClassComp.displayName || ClassComp.name || 'ClassComponent'}. Possible infinite loop.`);
        return null;
      }
      // Reset count on next frame
      if (renderGuardRef.current._raf === undefined) {
        renderGuardRef.current._raf = requestAnimationFrame(() => {
          renderGuardRef.current.count = 0;
          renderGuardRef.current.frame++;
          renderGuardRef.current._raf = undefined;
        });
      }
    }

    // Apply defaultProps
    let mergedProps = props;
    if (ClassComp.defaultProps) {
      mergedProps = { ...ClassComp.defaultProps, ...props };
    }

    if (instanceRef.current === null) {
      // Initialize state from constructor
      const instance = new ClassComp(mergedProps);

      // Apply getDerivedStateFromProps on initial render
      if (ClassComp.getDerivedStateFromProps) {
        const derived = ClassComp.getDerivedStateFromProps(mergedProps, instance.state);
        if (derived !== null && derived !== undefined) {
          instance.state = { ...instance.state, ...derived };
        }
      }

      // Throttle forceUpdate — coalesce rapid setState calls
      let updateScheduled = false;
      instance._forceUpdate = () => {
        if (!updateScheduled) {
          updateScheduled = true;
          queueMicrotask(() => {
            updateScheduled = false;
            forceRender(c => c + 1);
          });
        }
      };
      instanceRef.current = instance;
    }

    const instance = instanceRef.current;
    instance.props = mergedProps;

    // Apply getDerivedStateFromProps on every render (React semantics)
    if (ClassComp.getDerivedStateFromProps) {
      const derived = ClassComp.getDerivedStateFromProps(mergedProps, instance.state);
      if (derived !== null && derived !== undefined) {
        instance.state = { ...instance.state, ...derived };
      }
    }

    // Static contextType support — inject this.context from nearest provider
    if (ClassComp.contextType && ClassComp.contextType._whatContext) {
      try {
        instance.context = whatUseContext(ClassComp.contextType);
      } catch (e) {
        // Context not available — leave as undefined
      }
    }

    // componentDidMount / componentWillUnmount lifecycle
    whatUseEffect(() => {
      instance._mounted = true;
      if (instance.componentDidMount) {
        instance.componentDidMount();
      }
      return () => {
        instance._mounted = false;
        if (instance.componentWillUnmount) {
          instance.componentWillUnmount();
        }
      };
    }, []);

    // componentDidUpdate + getSnapshotBeforeUpdate
    const prevRef = whatUseRef({ props: null, state: null, rendered: false, snapshot: undefined });
    whatUseEffect(() => {
      if (!prevRef.current.rendered) {
        prevRef.current = { props: mergedProps, state: instance.state, rendered: true, snapshot: undefined };
        return;
      }
      const prev = prevRef.current;
      prevRef.current = { props: mergedProps, state: instance.state, rendered: true, snapshot: undefined };
      if (instance.componentDidUpdate) {
        instance.componentDidUpdate(prev.props, prev.state, prev.snapshot);
      }
    }, [mergedProps, renderCount]);

    // getSnapshotBeforeUpdate — capture before DOM updates
    // We approximate by calling it synchronously before render returns
    if (instance.getSnapshotBeforeUpdate && prevRef.current.rendered) {
      prevRef.current.snapshot = instance.getSnapshotBeforeUpdate(
        prevRef.current.props, prevRef.current.state
      );
    }

    return instance.render();
  };

  // Preserve static properties and displayName
  wrapper.displayName = ClassComp.displayName || ClassComp.name || 'ClassComponent';
  // Copy static properties (getDerivedStateFromProps, defaultProps, contextType, etc.)
  for (const key of Object.getOwnPropertyNames(ClassComp)) {
    if (key !== 'prototype' && key !== 'length' && key !== 'name' && key !== 'caller' && key !== 'arguments') {
      try { wrapper[key] = ClassComp[key]; } catch (e) {}
    }
  }

  classWrapperCache.set(ClassComp, wrapper);
  return wrapper;
}

// ---- createElement ----

export function createElement(type, props, ...children) {
  if (props == null) props = {};

  // Wrap class components so What's reconciler can call them as functions
  if (isClassComponent(type)) {
    type = getClassWrapper(type);
  }

  // React libraries sometimes pass children via props instead of as spread args
  // (e.g., React Router's createElement(Router, { children, location, ... })).
  // Move props.children into the spread children array so h() puts them
  // in vnode.children — otherwise the reconciler overwrites props.children.
  if (children.length === 0 && props.children !== undefined) {
    const pc = props.children;
    children = Array.isArray(pc) ? pc : [pc];
    props = { ...props };
    delete props.children;
  }

  // Normalize className → class, htmlFor → for for HTML elements
  if (typeof type === 'string') {
    if ('className' in props) {
      props.class = props.className;
      delete props.className;
    }
    if ('htmlFor' in props) {
      props.for = props.htmlFor;
      delete props.htmlFor;
    }
  }

  // Keep ref in props — What's reconciler handles ref for HTML elements,
  // and forwardRef components extract it from props. No need to strip.

  const vnode = children.length <= 1
    ? h(type, props, children[0])
    : h(type, props, ...children);

  // Alias tag → type so React libraries can access element.type
  vnode.type = vnode.tag;

  // Mirror children into props for React compat — React libraries read
  // element.props.children (e.g., React Router's createRoutesFromChildren)
  if (vnode.children.length > 0) {
    vnode.props = { ...vnode.props };
    vnode.props.children = vnode.children.length === 1
      ? vnode.children[0]
      : vnode.children;
  }

  return vnode;
}

// ---- forwardRef ----

export function forwardRef(render) {
  function ForwardRefComponent(props) {
    const { ref, ...rest } = props;
    return render(rest, ref || null);
  }
  ForwardRefComponent.displayName = render.displayName || render.name || 'ForwardRef';
  ForwardRefComponent._forwardRef = true;
  ForwardRefComponent.$$typeof = Symbol.for('react.forward_ref');
  return ForwardRefComponent;
}

// ---- createRef ----

export function createRef() {
  return { current: null };
}

// ---- Children utilities ----

export const Children = {
  map(children, fn) {
    if (children == null) return [];
    const arr = Array.isArray(children) ? children : [children];
    const result = [];
    let index = 0;
    for (const child of arr.flat(Infinity)) {
      if (child == null || child === false || child === true) continue;
      result.push(fn(child, index++));
    }
    return result;
  },

  forEach(children, fn) {
    Children.map(children, fn);
  },

  count(children) {
    if (children == null) return 0;
    const arr = Array.isArray(children) ? children : [children];
    return arr.flat(Infinity).filter(c => c != null && c !== false && c !== true).length;
  },

  toArray(children) {
    if (children == null) return [];
    const arr = Array.isArray(children) ? children : [children];
    return arr.flat(Infinity).filter(c => c != null && c !== false && c !== true);
  },

  only(children) {
    const arr = Children.toArray(children);
    if (arr.length !== 1) {
      throw new Error('React.Children.only expected to receive a single React element child.');
    }
    return arr[0];
  },
};

// ---- cloneElement ----

export function cloneElement(element, props, ...children) {
  if (!element) return element;

  // Handle both vnode objects and plain React-style elements
  const tag = element.tag || element.type;
  const oldProps = element.props || {};
  const oldChildren = element.children || [];
  const oldKey = element.key;
  const oldRef = oldProps.ref;

  if (!tag) return element;

  const newProps = { ...oldProps, ...props };
  // Preserve ref from old element if not overridden
  if (props && props.ref !== undefined) {
    newProps.ref = props.ref;
  } else if (oldRef !== undefined) {
    newProps.ref = oldRef;
  }
  const newChildren = children.length > 0 ? children : oldChildren;
  const newKey = props?.key !== undefined ? props.key : oldKey;
  if (newKey !== undefined) newProps.key = newKey;

  return createElement(tag, newProps, ...([].concat(newChildren || [])));
}

// ---- createFactory (deprecated but used by some libraries) ----

export function createFactory(type) {
  const factory = createElement.bind(null, type);
  factory.type = type;
  return factory;
}

// ---- isValidElement ----

export function isValidElement(object) {
  return (
    typeof object === 'object' &&
    object !== null &&
    (object._vnode === true || object.$$typeof !== undefined)
  );
}

// ---- useLayoutEffect ----
// Must run synchronously after DOM mutations but before paint.
// We use queueMicrotask for layout-level timing (runs before next rAF).

export function useLayoutEffect(fn, deps) {
  const hookRef = whatUseRef({ deps: undefined, cleanup: null });

  const hook = hookRef.current;

  if (_depsChanged(hook.deps, deps)) {
    // Run synchronously via microtask — before next paint but after DOM mutations
    queueMicrotask(() => {
      if (hook.cleanup) {
        try { hook.cleanup(); } catch (e) { /* cleanup error */ }
        hook.cleanup = null;
      }
      const result = fn();
      if (typeof result === 'function') {
        hook.cleanup = result;
      }
    });
    hook.deps = deps;
  }

  // Register cleanup on unmount
  onCleanup(() => {
    if (hook.cleanup) {
      try { hook.cleanup(); } catch (e) { /* cleanup error */ }
      hook.cleanup = null;
    }
  });
}

// ---- useInsertionEffect ----
// React 18 hook for CSS-in-JS libraries. Runs synchronously before layout effects.
// We run it immediately (synchronously) during render to ensure it runs before
// useLayoutEffect's microtask and useEffect's async scheduling.

export function useInsertionEffect(fn, deps) {
  const hookRef = whatUseRef({ deps: undefined, cleanup: null });

  const hook = hookRef.current;

  if (_depsChanged(hook.deps, deps)) {
    // Run synchronously — before layout effects
    if (hook.cleanup) {
      try { hook.cleanup(); } catch (e) { /* cleanup error */ }
      hook.cleanup = null;
    }
    const result = fn();
    if (typeof result === 'function') {
      hook.cleanup = result;
    }
    hook.deps = deps;
  }

  // Register cleanup on unmount
  onCleanup(() => {
    if (hook.cleanup) {
      try { hook.cleanup(); } catch (e) { /* cleanup error */ }
      hook.cleanup = null;
    }
  });
}

// ---- useImperativeHandle ----

export function useImperativeHandle(ref, createHandle, deps) {
  useLayoutEffect(() => {
    if (typeof ref === 'function') {
      const handle = createHandle();
      ref(handle);
      return () => ref(null);
    } else if (ref && typeof ref === 'object') {
      const handle = createHandle();
      ref.current = handle;
      return () => { ref.current = null; };
    }
  }, deps);
}

// ---- useId ----
let idCounter = 0;
export function useId() {
  const ref = whatUseRef(null);
  if (ref.current === null) {
    ref.current = ':w' + (++idCounter).toString(36) + ':';
  }
  return ref.current;
}

// ---- useDebugValue ----
export function useDebugValue() {}

// ---- useSyncExternalStore ----
// Uses a signal internally so that consumers get reactive updates.
// The signal is initialized with getSnapshot(), and updated via the store's
// subscribe callback. The returned signal function integrates with What's
// fine-grained reactivity — reading it inside an effect auto-tracks the dependency.

export function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
  // Create a signal initialized with the current snapshot
  const storeSignal = whatUseRef(null);
  if (storeSignal.current === null) {
    storeSignal.current = signal(getSnapshot());
  }

  const sig = storeSignal.current;

  // Subscribe to the store, updating the signal when the store changes.
  // onCleanup handles unsubscription on unmount.
  whatUseEffect(() => {
    const handleChange = () => {
      const next = getSnapshot();
      const prev = sig.peek();
      if (!Object.is(prev, next)) {
        sig.set(next);
      }
    };
    // Sync in case store changed between render and effect
    handleChange();
    const unsubscribe = subscribe(handleChange);
    return unsubscribe;
  }, [subscribe, getSnapshot]);

  // Return the signal function itself. In the run-once model, returning sig()
  // would capture a snapshot that never updates. Returning the signal function
  // lets the fine-grained runtime track it reactively when used in JSX.
  return sig;
}

// ---- useTransition ----

export function useTransition() {
  const [isPending, setIsPending] = whatUseState(false);

  function startTransitionFn(fn) {
    setIsPending(true);
    queueMicrotask(() => {
      batch(() => {
        fn();
        setIsPending(false);
      });
    });
  }

  return [isPending, startTransitionFn];
}

// ---- useDeferredValue ----

export function useDeferredValue(value) {
  const [deferred, setDeferred] = whatUseState(value);

  whatUseEffect(() => {
    setDeferred(value);
  }, [value]);

  return deferred;
}

// ---- startTransition (module-level) ----

export function startTransition(fn) {
  queueMicrotask(() => {
    batch(fn);
  });
}

// ---- StrictMode ----

export function StrictMode({ children }) {
  return children;
}

// ---- Component / PureComponent ----
// Use function constructors (not native classes) so that transpiled code
// using Component.call(this, props) works alongside native class extends.

export function Component(props) {
  this.props = props;
  this.state = {};
  this._stateSignal = null;
  this._mounted = false;
  this._forceUpdate = null;
}

Component.prototype.isReactComponent = {};

Component.prototype.setState = function(update, callback) {
  const nextState = typeof update === 'function'
    ? { ...this.state, ...update(this.state, this.props) }
    : { ...this.state, ...update };

  this.state = nextState;

  if (this._forceUpdate) {
    this._forceUpdate();
  }

  if (callback) {
    queueMicrotask(callback);
  }
};

Component.prototype.forceUpdate = function(callback) {
  if (this._forceUpdate) {
    this._forceUpdate();
  }
  if (callback) {
    queueMicrotask(callback);
  }
};

Component.prototype.render = function() {
  return null;
};

export function PureComponent(props) {
  Component.call(this, props);
}

PureComponent.prototype = Object.create(Component.prototype);
PureComponent.prototype.constructor = PureComponent;
PureComponent.prototype.isPureReactComponent = true;

PureComponent.prototype.shouldComponentUpdate = function(nextProps, nextState) {
  return !shallowEqual(this.props, nextProps) || !shallowEqual(this.state, nextState);
};

// ---- Internal helpers ----

function _depsChanged(oldDeps, newDeps) {
  if (oldDeps === undefined) return true;
  if (!oldDeps || !newDeps) return true;
  if (oldDeps.length !== newDeps.length) return true;
  for (let i = 0; i < oldDeps.length; i++) {
    if (!Object.is(oldDeps[i], newDeps[i])) return true;
  }
  return false;
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

// ---- React internals that some libraries check ----
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
  ReactCurrentOwner: { current: null },
  ReactCurrentDispatcher: { current: null },
};

// ---- Version ----
export const version = '18.3.1';

// ---- Default export (import * as React from 'react') ----
const React = {
  useState: whatUseState,
  useEffect: whatUseEffect,
  useLayoutEffect,
  useInsertionEffect,
  useMemo: whatUseMemo,
  useCallback: whatUseCallback,
  useRef: whatUseRef,
  useContext: whatUseContext,
  useReducer: whatUseReducer,
  useImperativeHandle,
  useId,
  useDebugValue,
  useSyncExternalStore,
  useTransition,
  useDeferredValue,
  createElement,
  createContext: whatCreateContext,
  createRef,
  createFactory,
  forwardRef,
  cloneElement,
  isValidElement,
  Component,
  PureComponent,
  Fragment: WhatFragment,
  Suspense: WhatSuspense,
  StrictMode,
  memo: whatMemo,
  lazy: whatLazy,
  Children,
  startTransition,
  version,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
};

export default React;
