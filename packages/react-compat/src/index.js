/**
 * what-react — React compatibility layer for What Framework
 *
 * Implements React's public API on top of a dedicated compat runtime
 * (src/runtime.js) that provides REAL React semantics:
 * - hooks return VALUES (not signal accessors),
 * - components re-render on state change,
 * - re-render output is reconciled (keyed diff) so DOM and child component
 *   state are preserved.
 *
 * Alias "react" → "what-react" in your bundler to use React libraries
 * (see the reactCompat() vite plugin: what-react/vite).
 *
 * What's own components are unaffected: vnodes not created by this module are
 * delegated to what-core's run-once renderer, and compat components embedded
 * in native What trees render through a run-once bridge component.
 */

import { Fragment as WhatFragment } from 'what-core';
import { getBridge, _getCurrentInstance, flushUpdates, _drainAll, runInCommit } from './runtime.js';
import {
  useState,
  useReducer,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  useInsertionEffect,
  useImperativeHandle,
  useContext,
  createContext,
  useSyncExternalStore,
  useTransition,
  useDeferredValue,
  startTransition,
  useId,
  useDebugValue,
  use,
} from './hooks.js';

// ---- Re-export hooks ----

export {
  useState,
  useReducer,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  useInsertionEffect,
  useImperativeHandle,
  useContext,
  createContext,
  useSyncExternalStore,
  useTransition,
  useDeferredValue,
  startTransition,
  useId,
  useDebugValue,
  use,
};

export const Fragment = WhatFragment;

// ---- Class components ----

function isClassComponent(type) {
  return (
    typeof type === 'function' &&
    type.prototype != null &&
    (type.prototype.isReactComponent || typeof type.prototype.render === 'function')
  );
}

const classWrapperCache = new WeakMap();

function getClassWrapper(ClassComp) {
  let wrapper = classWrapperCache.get(ClassComp);
  if (wrapper) return wrapper;

  const isErrorBoundary =
    typeof ClassComp.getDerivedStateFromError === 'function' ||
    typeof ClassComp.prototype.componentDidCatch === 'function';

  wrapper = function ClassComponentWrapper(props) {
    const instanceRef = useRef(null);
    const [, forceRender] = useReducer((c) => c + 1, 0);

    let mergedProps = props;
    if (ClassComp.defaultProps) {
      mergedProps = { ...ClassComp.defaultProps, ...props };
    }

    if (instanceRef.current === null) {
      const instance = new ClassComp(mergedProps);
      if (instance.state === undefined) instance.state = {};
      instance._forceUpdate = forceRender;
      instanceRef.current = instance;
    }

    const instance = instanceRef.current;
    instance.props = mergedProps;

    // getDerivedStateFromProps runs before every render (React semantics)
    if (ClassComp.getDerivedStateFromProps) {
      const derived = ClassComp.getDerivedStateFromProps(mergedProps, instance.state);
      if (derived != null) {
        instance.state = { ...instance.state, ...derived };
      }
    }

    // static contextType — inject this.context from the nearest provider
    if (ClassComp.contextType) {
      instance.context = useContext(ClassComp.contextType);
    }

    // Error boundary registration (componentDidCatch / getDerivedStateFromError)
    if (isErrorBoundary) {
      const inst = _getCurrentInstance();
      if (inst && !inst._errorHandler) {
        inst._errorHandler = (error) => {
          if (ClassComp.getDerivedStateFromError) {
            const derived = ClassComp.getDerivedStateFromError(error);
            if (derived != null) instance.state = { ...instance.state, ...derived };
          }
          if (instance.componentDidCatch) {
            try { instance.componentDidCatch(error, { componentStack: '' }); } catch (e) { /* boundary error */ }
          }
          forceRender();
        };
      }
    }

    // componentDidMount / componentWillUnmount
    useEffect(() => {
      instance._mounted = true;
      if (instance.componentDidMount) instance.componentDidMount();
      return () => {
        instance._mounted = false;
        if (instance.componentWillUnmount) instance.componentWillUnmount();
      };
    }, []);

    // componentDidUpdate (+ getSnapshotBeforeUpdate approximation)
    const prevRef = useRef(null);
    const snapshot = (prevRef.current && instance.getSnapshotBeforeUpdate)
      ? instance.getSnapshotBeforeUpdate(prevRef.current.props, prevRef.current.state)
      : undefined;
    useLayoutEffect(() => {
      const prev = prevRef.current;
      prevRef.current = { props: mergedProps, state: instance.state };
      if (prev && instance.componentDidUpdate) {
        instance.componentDidUpdate(prev.props, prev.state, snapshot);
      }
    });

    // shouldComponentUpdate is intentionally not consulted — the compat
    // runtime always re-renders on parent cascade; use React.memo to skip.

    return instance.render();
  };

  wrapper.displayName = ClassComp.displayName || ClassComp.name || 'ClassComponent';
  // Copy static properties (defaultProps, contextType, custom statics)
  for (const key of Object.getOwnPropertyNames(ClassComp)) {
    if (key !== 'prototype' && key !== 'length' && key !== 'name' && key !== 'caller' && key !== 'arguments') {
      try { wrapper[key] = ClassComp[key]; } catch (e) { /* read-only static */ }
    }
  }

  classWrapperCache.set(ClassComp, wrapper);
  return wrapper;
}

// ---- createElement ----

const EMPTY_CHILDREN = [];

// Flatten nested arrays but PRESERVE holes (null/false/true) so child slot
// positions stay stable across conditional renders (React semantics).
function flattenChildren(children, out) {
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (Array.isArray(child)) flattenChildren(child, out);
    else out.push(child);
  }
  return out;
}

export function createElement(type, props, ...children) {
  if (props == null) props = {};

  // Resolve the render target and vnode tag:
  // - vnode.type stays the ORIGINAL component (libraries compare element.type)
  // - vnode.tag is the What-native bridge so core's renderer can also render
  //   compat vnodes; the compat runtime unwraps tag._compatType.
  let tag = type;
  if (typeof type === 'function') {
    const renderType = isClassComponent(type) ? getClassWrapper(type) : type;
    tag = getBridge(renderType);
  } else if (typeof type !== 'string') {
    console.error('[what-react] createElement: invalid element type:', type);
  }

  const rawKids = children.length > 0
    ? children
    : (props.children !== undefined ? [props.children] : EMPTY_CHILDREN);
  const kids = rawKids.length > 0 ? flattenChildren(rawKids, []) : EMPTY_CHILDREN;

  // Normalize className → class, htmlFor → for on host elements so vnodes
  // also render correctly through what-core's renderer (interop path).
  if (typeof type === 'string' && ('className' in props || 'htmlFor' in props)) {
    props = { ...props };
    if ('className' in props) {
      props.class = props.className;
      delete props.className;
    }
    if ('htmlFor' in props) {
      props.for = props.htmlFor;
      delete props.htmlFor;
    }
  }

  const key = props.key !== undefined ? props.key : null;
  let finalProps = props;
  if (props.key !== undefined) {
    finalProps = { ...props };
    delete finalProps.key;
  }

  // Mirror children into props.children — React libraries read element.props.children
  if (kids.length > 0) {
    if (finalProps === props) finalProps = { ...props };
    finalProps.children = kids.length === 1 ? kids[0] : kids;
  }

  return {
    tag,
    type,
    props: finalProps,
    children: kids,
    key,
    _vnode: true,
    _compat: true,
  };
}

// ---- forwardRef ----
// ref stays in props (React 19-style); forwardRef components receive it as
// the second argument.

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

// ---- memo ----
// Real memo semantics: the compat runtime skips re-render when props compare
// equal (default: shallow equality) and no self-update is pending.

export function memo(Component, areEqual) {
  const render = isClassComponent(Component) ? getClassWrapper(Component) : Component;
  function Memoized(props) {
    return render(props);
  }
  Memoized.displayName = `Memo(${Component.displayName || Component.name || 'Anonymous'})`;
  Memoized._memoCompare = areEqual || shallowEqual;
  Memoized._memoType = Component;
  return Memoized;
}

// ---- lazy / Suspense ----

export function lazy(loader) {
  let Component = null;
  let promise = null;
  let error = null;

  function LazyComponent(props) {
    if (error) throw error;
    if (Component) return createElement(Component, props);
    if (!promise) {
      promise = loader().then(
        (mod) => { Component = (mod && mod.default) || mod; },
        (err) => { error = err; },
      );
    }
    throw promise; // caught by the nearest Suspense boundary
  }
  LazyComponent.displayName = 'Lazy';
  LazyComponent._lazy = true;
  return LazyComponent;
}

export function Suspense(props) {
  const inst = _getCurrentInstance();
  if (inst) inst._isSuspense = true;
  if (inst && inst._suspendCount > 0) {
    return props.fallback !== undefined ? props.fallback : null;
  }
  return props.children;
}
Suspense.displayName = 'Suspense';

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
    return arr.flat(Infinity).filter((c) => c != null && c !== false && c !== true).length;
  },

  toArray(children) {
    if (children == null) return [];
    const arr = Array.isArray(children) ? children : [children];
    return arr.flat(Infinity).filter((c) => c != null && c !== false && c !== true);
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

  const type = element.type !== undefined ? element.type : element.tag;
  const oldProps = element.props || {};
  const oldChildren = element.children || [];
  const oldKey = element.key;
  const oldRef = oldProps.ref;

  if (!type) return element;

  const newProps = { ...oldProps, ...props };
  if (props && props.ref !== undefined) {
    newProps.ref = props.ref;
  } else if (oldRef !== undefined) {
    newProps.ref = oldRef;
  }
  const newChildren = children.length > 0 ? children : oldChildren;
  const newKey = props && props.key !== undefined ? props.key : oldKey;
  if (newKey != null) newProps.key = newKey;
  else delete newProps.key;

  // Don't double-pass children via props
  if (children.length > 0) delete newProps.children;

  return createElement(type, newProps, ...[].concat(newChildren || []));
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

// ---- StrictMode ----

export function StrictMode(props) {
  return props.children;
}
StrictMode.displayName = 'StrictMode';

// ---- act (testing helper) ----
// Runs the callback, then synchronously drains renders + effects.

export function act(callback) {
  const result = callback && callback();
  if (result && typeof result.then === 'function') {
    return result.then(() => { _drainAll(); });
  }
  _drainAll();
  return { then(resolve) { _drainAll(); if (resolve) resolve(); } };
}

// ---- Component / PureComponent ----
// Function constructors (not native classes) so transpiled code using
// Component.call(this, props) works alongside native class extends.

export function Component(props) {
  this.props = props;
  this.state = {};
  this._mounted = false;
  this._forceUpdate = null;
}

Component.prototype.isReactComponent = {};

Component.prototype.setState = function (update, callback) {
  const nextState = typeof update === 'function'
    ? { ...this.state, ...update(this.state, this.props) }
    : { ...this.state, ...update };

  this.state = nextState;
  if (this._forceUpdate) this._forceUpdate();
  if (callback) queueMicrotask(callback);
};

Component.prototype.forceUpdate = function (callback) {
  if (this._forceUpdate) this._forceUpdate();
  if (callback) queueMicrotask(callback);
};

Component.prototype.render = function () {
  return null;
};

export function PureComponent(props) {
  Component.call(this, props);
}

PureComponent.prototype = Object.create(Component.prototype);
PureComponent.prototype.constructor = PureComponent;
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

// ---- flushSync re-export (some libraries import it from 'react') ----

export { flushUpdates as unstable_flushUpdates };

// ---- React internals that some libraries check ----

export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
  ReactCurrentOwner: { current: null },
  ReactCurrentDispatcher: { current: null },
};

// ---- Version ----

export const version = '18.3.1';

// ---- Default export (import * as React from 'react') ----

const React = {
  useState,
  useReducer,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  useInsertionEffect,
  useImperativeHandle,
  useContext,
  createContext,
  useSyncExternalStore,
  useTransition,
  useDeferredValue,
  startTransition,
  useId,
  useDebugValue,
  use,
  createElement,
  createRef,
  createFactory,
  forwardRef,
  cloneElement,
  isValidElement,
  Component,
  PureComponent,
  Fragment,
  Suspense,
  StrictMode,
  memo,
  lazy,
  act,
  Children,
  version,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
};

export default React;
