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

function getClassWrapper(ClassComp) {
  let wrapper = classWrapperCache.get(ClassComp);
  if (wrapper) return wrapper;

  wrapper = function ClassComponentWrapper(props) {
    // Instantiate the class with new
    const instanceRef = whatUseRef(null);
    const [renderCount, forceRender] = whatUseState(0);

    if (instanceRef.current === null) {
      const instance = new ClassComp(props);
      // Throttle forceUpdate to prevent infinite loops from rapid setState
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
    instance.props = props;

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

    // componentDidUpdate — track with render count to avoid infinite loops
    const prevRef = whatUseRef({ props: null, state: null, rendered: false });
    whatUseEffect(() => {
      if (!prevRef.current.rendered) {
        // First render — skip (componentDidMount handles this)
        prevRef.current = { props, state: instance.state, rendered: true };
        return;
      }
      const prev = prevRef.current;
      prevRef.current = { props, state: instance.state, rendered: true };
      if (instance.componentDidUpdate) {
        instance.componentDidUpdate(prev.props, prev.state);
      }
    }, [props, renderCount]);

    return instance.render();
  };

  // Preserve static properties and displayName
  wrapper.displayName = ClassComp.displayName || ClassComp.name || 'ClassComponent';
  // Copy static properties (e.g., getDerivedStateFromProps, defaultProps)
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
  if (!element || !element._vnode) {
    return element;
  }

  const newProps = { ...element.props, ...props };
  const newChildren = children.length > 0 ? children : element.children;
  const newKey = props?.key !== undefined ? props.key : element.key;

  return h(element.tag, { ...newProps, key: newKey }, ...([].concat(newChildren || [])));
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

export function useLayoutEffect(fn, deps) {
  return whatUseEffect(fn, deps);
}

// ---- useInsertionEffect ----
// React 18 hook for CSS-in-JS libraries. Runs synchronously before layout effects.
// We map it to useEffect since What doesn't have multi-phase commit.

export function useInsertionEffect(fn, deps) {
  return whatUseEffect(fn, deps);
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

export function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
  const [value, setValue] = whatUseState(() => getSnapshot());
  const snapshotRef = whatUseRef(getSnapshot());

  whatUseEffect(() => {
    const handleChange = () => {
      const next = getSnapshot();
      if (!Object.is(snapshotRef.current, next)) {
        snapshotRef.current = next;
        setValue(next);
      }
    };
    handleChange();
    return subscribe(handleChange);
  }, [subscribe, getSnapshot]);

  return value;
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

export class Component {
  constructor(props) {
    this.props = props;
    this.state = {};
    this._stateSignal = null;
    this._mounted = false;
    this._forceUpdate = null;
  }

  setState(update, callback) {
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
  }

  forceUpdate(callback) {
    if (this._forceUpdate) {
      this._forceUpdate();
    }
    if (callback) {
      queueMicrotask(callback);
    }
  }

  render() {
    return null;
  }
}

Component.prototype.isReactComponent = {};

export class PureComponent extends Component {
  shouldComponentUpdate(nextProps, nextState) {
    return !shallowEqual(this.props, nextProps) || !shallowEqual(this.state, nextState);
  }
}

PureComponent.prototype.isPureReactComponent = true;

// ---- Internal helpers ----

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
