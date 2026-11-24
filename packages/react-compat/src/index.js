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

import { h, Fragment as WhatFragment } from 'what-core';
import { isVNode } from 'what-core/internal';
import { getBridge, _getCurrentInstance, flushUpdates, _drainAll, _setRangeHidden } from './runtime.js';
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
  useOptimistic,
  useActionState,
  useEffectEvent,
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
  useOptimistic,
  useActionState,
  useEffectEvent,
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

  const pure = ClassComp.prototype.isPureReactComponent === true;
  const derives = typeof ClassComp.getDerivedStateFromProps === 'function';
  const defaults = ClassComp.defaultProps;

  wrapper = function ClassComponentWrapper(props) {
    const instanceRef = useRef(null);
    const [, forceRender] = useReducer((c) => c + 1, 0);

    let instance = instanceRef.current;
    const mounting = instance === null;

    // A ref on a class component is the instance, never a prop of it.
    const ref = props.ref ?? null;
    let mergedProps = props;
    if (!mounting && instance._rawProps === props) {
      // Its own re-render (setState): the props object it already has.
      mergedProps = instance.props;
    } else if ('ref' in props || defaults) {
      mergedProps = {};
      for (const name in props) if (name !== 'ref') mergedProps[name] = props[name];
      // A default stands in for a prop that is undefined, as in React.
      if (defaults) for (const name in defaults) if (mergedProps[name] === undefined) mergedProps[name] = defaults[name];
    }

    // static contextType: the constructor's second argument and this.context.
    const context = ClassComp.contextType ? useContext(ClassComp.contextType) : undefined;

    if (mounting) {
      instance = instanceRef.current = new ClassComp(mergedProps, context);
      if (instance.state === undefined) instance.state = {};
      instance.props = mergedProps;
      instance.context = context;
      instance._enqueue = forceRender;
      instance._compatInst = _getCurrentInstance();
      // The legacy mount lifecycle, which React skips for a class with the new ones.
      if (!derives && typeof instance.getSnapshotBeforeUpdate !== 'function') {
        if (typeof instance.componentWillMount === 'function') instance.componentWillMount();
        if (typeof instance.UNSAFE_componentWillMount === 'function') instance.UNSAFE_componentWillMount();
      }
    } else if (!derives && typeof instance.getSnapshotBeforeUpdate !== 'function' && (instance.props !== mergedProps || instance.context !== context)) {
      if (typeof instance.componentWillReceiveProps === 'function') instance.componentWillReceiveProps(mergedProps, context);
      if (typeof instance.UNSAFE_componentWillReceiveProps === 'function') instance.UNSAFE_componentWillReceiveProps(mergedProps, context);
    }

    // The state for this render: what setState queued, applied in order (an
    // updater sees the result of the one before it and the new props). Until
    // the render, this.state is still the last one, which is what
    // shouldComponentUpdate compares its nextState with.
    let state = instance.state;
    const queued = instance._pendingState;
    if (queued !== undefined && queued.length > 0) {
      instance._pendingState = [];
      for (const update of queued) {
        const partial = typeof update === 'function' ? update.call(instance, state, mergedProps) : update;
        if (partial != null) state = { ...state, ...partial };
      }
    }
    // getDerivedStateFromProps runs before every render (React semantics)
    if (derives) {
      const derived = ClassComp.getDerivedStateFromProps(mergedProps, state);
      if (derived != null) state = { ...state, ...derived };
    }

    // What the last render used: componentDidUpdate's arguments, and what
    // shouldComponentUpdate and PureComponent compare against.
    const last = instance._last;
    const forced = instance._forced === true;
    instance._forced = false;
    let update = true;
    if (!mounting && !forced && last !== undefined) {
      if (typeof instance.shouldComponentUpdate === 'function') update = instance.shouldComponentUpdate(mergedProps, state, context) !== false;
      else if (pure) update = !shallowEqual(last.props, mergedProps) || !shallowEqual(last.state, state);
    }
    if (update && !mounting && !derives && typeof instance.getSnapshotBeforeUpdate !== 'function') {
      if (typeof instance.componentWillUpdate === 'function') instance.componentWillUpdate(mergedProps, state, context);
      if (typeof instance.UNSAFE_componentWillUpdate === 'function') instance.UNSAFE_componentWillUpdate(mergedProps, state, context);
    }
    // React hands the instance its new props and state also when it skips the render.
    instance.props = mergedProps;
    instance.state = state;
    instance.context = context;
    instance._rawProps = props;

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
            try { instance.componentDidCatch(error, { componentStack: '' }); } catch { /* boundary error */ }
          }
          instance._forced = true;
          forceRender();
        };
      }
    }

    // componentDidMount / componentWillUnmount, in the commit like React's:
    // after the DOM is in place and before the browser paints.
    useLayoutEffect(() => {
      instance._mounted = true;
      if (instance.componentDidMount) instance.componentDidMount();
      return () => {
        instance._mounted = false;
        if (instance.componentWillUnmount) instance.componentWillUnmount();
      };
    }, []);

    // The ref is the instance (React attaches it after componentDidMount).
    useLayoutEffect(() => {
      if (ref === null) return undefined;
      if (typeof ref === 'function') {
        const cleanup = ref(instance);
        return typeof cleanup === 'function' ? cleanup : () => ref(null);
      }
      ref.current = instance;
      return () => { ref.current = null; };
    }, [ref]);

    // componentDidUpdate (+ getSnapshotBeforeUpdate approximation), then the
    // callbacks setState and forceUpdate were given.
    const updated = update && !mounting && last !== undefined;
    const snapshot = (updated && instance.getSnapshotBeforeUpdate)
      ? instance.getSnapshotBeforeUpdate(last.props, last.state)
      : undefined;
    useLayoutEffect(() => {
      if (updated && instance.componentDidUpdate) instance.componentDidUpdate(last.props, last.state, snapshot);
      const callbacks = instance._callbacks;
      if (callbacks !== undefined && callbacks.length > 0) {
        instance._callbacks = [];
        for (const callback of callbacks) callback.call(instance);
      }
    });

    // shouldComponentUpdate said no (or a PureComponent's props and state
    // are shallowly equal): the last output again, which the reconciler
    // recognises and leaves alone, children included.
    if (!update) return last.output;
    const output = instance.render();
    instance._last = { props: mergedProps, state, output };
    return output;
  };

  wrapper.displayName = ClassComp.displayName || ClassComp.name || 'ClassComponent';
  // Copy static properties (defaultProps, contextType, custom statics)
  for (const key of Object.getOwnPropertyNames(ClassComp)) {
    if (key !== 'prototype' && key !== 'length' && key !== 'name' && key !== 'caller' && key !== 'arguments') {
      try { wrapper[key] = ClassComp[key]; } catch { /* read-only static */ }
    }
  }

  classWrapperCache.set(ClassComp, wrapper);
  return wrapper;
}

// ---- createElement ----

const EMPTY_CHILDREN = [];

// ---- React element brands ----
// Ecosystem libraries do not duck-type elements, they check the brand:
// MUI, emotion, styled-components, recharts and react-select all compare
// `element.$$typeof` against `Symbol.for('react.element')` before treating a
// value as renderable. Without it they classify every compat element as a plain
// object and silently render nothing.
//
// The brand is also why React elements are XSS-safe against JSON injection: a
// symbol cannot survive JSON.parse, so an attacker-supplied object can never
// impersonate an element. isValidElement() below relies on that.
//
// React 19 renamed its internal brand to 'react.transitional.element', but
// library code in the wild overwhelmingly still compares against
// 'react.element', which is also what preact/compat brands with.
//
// Fragment is deliberately NOT branded here: it is what-core's own export, and
// stamping a React symbol onto it would mutate a shared object for every
// consumer of the framework, compat or not. Context is already branded where it
// is created (hooks.js).
const REACT_ELEMENT_TYPE = Symbol.for('react.element');
const REACT_MEMO_TYPE = Symbol.for('react.memo');
const REACT_LAZY_TYPE = Symbol.for('react.lazy');
const REACT_SUSPENSE_TYPE = Symbol.for('react.suspense');
const REACT_CONTEXT_TYPE = Symbol.for('react.context');

export function createElement(type, props, ...children) {
  if (props == null) props = {};
  // React's rule for props.children: the one child, or the array of them.
  if (children.length > 0) props = { ...props, children: children.length === 1 ? children[0] : children };
  return _element(type, props);
}

/**
 * The element for `type` with `props` as React holds them: `props.children`
 * is the child (or the array of children), untouched, so an array a caller
 * memoized keeps its identity. createElement and the JSX runtime end here.
 */
export function _element(type, props) {
  // Resolve the render target and vnode tag:
  // - vnode.type stays the ORIGINAL component (libraries compare element.type)
  // - vnode.tag is the What-native bridge so core's renderer can also render
  //   compat vnodes; the compat runtime unwraps tag._compatType.
  let tag = type;
  if (typeof type === 'function') {
    const renderType = isClassComponent(type) ? getClassWrapper(type) : type;
    tag = getBridge(renderType);
  } else if (type !== null && typeof type === 'object' && type.$$typeof === REACT_CONTEXT_TYPE && typeof type.Provider === 'function') {
    // React 19: a context renders as its own provider (<Theme value="dark">).
    tag = getBridge(type.Provider);
  } else if (typeof type !== 'string') {
    console.error('[what-react] createElement: invalid element type:', type);
  }

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

  // The child list: the children, or the array passed as the only child (a
  // `.map()` list). An array inside the list stays one: the runtime
  // reconciles it as a list of its own, so the children after it keep their
  // slots when it grows (React gives a nested array a fragment).
  const only = props.children;
  const kids = only === undefined ? EMPTY_CHILDREN : Array.isArray(only) ? only : [only];

  // Core's producer makes the vnode (taking `key` out of the props) and
  // installs core's vnode renderer in any bundle that creates one. Its
  // children are replaced with this module's list, which keeps the holes the
  // runtime reconciles by position and h() would drop.
  // `ref` is a prop (React 19) and is on the element too, where React 18 and
  // the libraries written for it read it (`element.ref`).
  return Object.assign(h(tag, props), { $$typeof: REACT_ELEMENT_TYPE, type, ref: props.ref !== undefined ? props.ref : null, children: kids, _compat: true });
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
  // Libraries unwrap a memo with `type.$$typeof === REACT_MEMO_TYPE ? type.type : type`
  // to reach the component underneath (to read its displayName, propTypes, or to
  // decide whether it is a class). Carry both halves of that contract.
  Memoized.$$typeof = REACT_MEMO_TYPE;
  Memoized.type = Component;
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
  LazyComponent.$$typeof = REACT_LAZY_TYPE;
  return LazyComponent;
}

// A <Suspense> renders two slots: its content and its fallback. Content that
// suspends on its first mount is not kept (nothing was shown yet): the
// fallback stands alone, and the content mounts when the promise settles.
// Content that suspends after it was shown stays mounted, hidden, with the
// fallback after it, so its state and DOM are the same when it comes back
// (the runtime decides which, in handleRenderError).
export function Suspense(props) {
  const inst = _getCurrentInstance();
  if (inst) inst._isSuspense = true;
  const suspended = inst != null && (inst._suspendCount ?? 0) > 0;
  const fallback = props.fallback !== undefined ? props.fallback : null;
  if (suspended && inst._keepPrimary !== true) return [null, fallback];
  return [createElement(SuspenseContent, { hidden: suspended }, props.children), suspended ? fallback : null];
}
Suspense.displayName = 'Suspense';
Suspense.$$typeof = REACT_SUSPENSE_TYPE;

function SuspenseContent(props) {
  const inst = /** @type {any} */ (_getCurrentInstance());
  const hidden = props.hidden === true;
  useLayoutEffect(() => {
    if (!hidden && inst.parent) inst.parent._primaryShown = true;
    _setRangeHidden(inst, hidden);
  });
  useLayoutEffect(() => () => {
    if (inst.parent) inst.parent._primaryShown = false;
  }, []);
  return props.children;
}
SuspenseContent.displayName = 'SuspenseContent';

// ---- Children utilities ----

// React's rules: a nested array is walked in place; null, undefined and
// booleans are one empty child each, handed to the callback as null and
// counted by count(); what the callback returns is flattened, its empties
// dropped, and each element in the result gets a key made from the child it
// came from ('.$key' or '.index'), so a list filtered with toArray() keeps its
// children's identity when one of them comes or goes.
function walkChildren(children, visit) {
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) walkChildren(children[i], visit);
    return;
  }
  visit(children == null || typeof children === 'boolean' ? null : children);
}

function pushMapped(out, mapped, childKey) {
  if (Array.isArray(mapped)) {
    for (let i = 0; i < mapped.length; i++) {
      const item = mapped[i];
      const own = isValidElement(item) && item.key != null ? '$' + item.key : i.toString(36);
      pushMapped(out, item, childKey + '/.' + own);
    }
    return;
  }
  if (mapped == null || typeof mapped === 'boolean') return;
  if (isValidElement(mapped)) {
    out.push(cloneElement(mapped, { key: childKey }));
    return;
  }
  out.push(mapped);
}

export const Children = {
  map(children, fn, thisArg) {
    if (children == null) return children;
    const result = [];
    let index = 0;
    walkChildren(children, (child) => {
      const i = index++;
      const mapped = fn.call(thisArg, child, i);
      let key = '.' + (isValidElement(child) && child.key != null ? '$' + child.key : i.toString(36));
      // A key the callback gave its result, kept in front of the child's.
      if (isValidElement(mapped) && mapped.key != null && (!isValidElement(child) || child.key !== mapped.key)) key = mapped.key + '/' + key;
      pushMapped(result, mapped, key);
    });
    return result;
  },

  forEach(children, fn, thisArg) {
    if (children == null) return;
    let index = 0;
    walkChildren(children, (child) => { fn.call(thisArg, child, index++); });
  },

  count(children) {
    if (children == null) return 0;
    let n = 0;
    walkChildren(children, () => { n++; });
    return n;
  },

  toArray(children) {
    return Children.map(children, (child) => child) || [];
  },

  only(children) {
    if (!isValidElement(children)) {
      // ERROR_CODES.CHILDREN_ONLY
      throw Object.assign(
        new Error('React.Children.only expected to receive a single React element child.'),
        { code: 'ERR_CHILDREN_ONLY' },
      );
    }
    return children;
  },
};

// ---- cloneElement ----
// Only an element is cloned (isValidElement). Anything else comes back as it
// is, so `isValidElement(c) ? cloneElement(c, extra) : c` and a bare
// `cloneElement(c, extra)` treat data the same way: an object from JSON, a
// store or a server action renders as text, never as the element its fields
// describe.

export function cloneElement(element, props, ...children) {
  if (!isValidElement(element)) return element;

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
  /** @type {any} */ (factory).type = type;
  return factory;
}

// ---- isValidElement ----
// An element is a vnode (what-core's private brand: every element this module
// makes is one) or an object carrying React's element symbol, which only code
// can set: JSON, structuredClone and postMessage cannot carry a symbol, so a
// payload that spells `"$$typeof": "react.element"` is still data.

export function isValidElement(object) {
  return isVNode(object) || (typeof object === 'object' && object !== null && object.$$typeof === REACT_ELEMENT_TYPE);
}

// ---- StrictMode / Profiler / Activity ----

export function StrictMode(props) {
  return props.children;
}
StrictMode.displayName = 'StrictMode';

// Renders its children; nothing is measured (onRender is never called).
export function Profiler(props) {
  return props.children;
}
Profiler.displayName = 'Profiler';

// React 19.2. `hidden` renders nothing here: React keeps the hidden tree's
// state and DOM, this unmounts it (see REACT-COMPAT.md, known limitations).
export function Activity(props) {
  return props.mode === 'hidden' ? null : props.children;
}
Activity.displayName = 'Activity';

// ---- cache / captureOwnerStack ----

// Outside server components React's cache() memoizes nothing: each call runs `fn`.
export function cache(fn) {
  return /** @this {unknown} */ function (...args) {
    return fn.apply(this, args);
  };
}

/** Development only in React; there is no owner stack here. */
export function captureOwnerStack() {
  return null;
}

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

/**
 * @this {{ props: any, state: any, context: any, _mounted: boolean, _enqueue: (() => void) | null, [key: string]: any }}
 * @param {any} props
 * @param {any} [context]
 */
export function Component(props, context) {
  this.props = props;
  this.context = context;
  this.state = {};
  this._mounted = false;
  this._enqueue = null;
}

Component.prototype.isReactComponent = {};

Component.prototype.setState = function (update, callback) {
  if (callback) (this._callbacks || (this._callbacks = [])).push(callback);
  if (this._enqueue) {
    // Queued: this.state changes when the component renders, as in React.
    (this._pendingState || (this._pendingState = [])).push(update);
    this._enqueue();
    return;
  }
  // Not rendered by the runtime (yet): the state is set directly.
  const partial = typeof update === 'function' ? update.call(this, this.state, this.props) : update;
  if (partial != null) this.state = { ...this.state, ...partial };
};

Component.prototype.forceUpdate = function (callback) {
  // Skips shouldComponentUpdate, as in React.
  this._forced = true;
  if (callback) (this._callbacks || (this._callbacks = [])).push(callback);
  if (this._enqueue) this._enqueue();
};

Component.prototype.render = function () {
  return null;
};

/**
 * @this {{ props: any, state: any, context: any, _mounted: boolean, _enqueue: (() => void) | null, [key: string]: any }}
 * @param {any} props
 * @param {any} [context]
 */
export function PureComponent(props, context) {
  Component.call(this, props, context);
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
export { Activity as unstable_Activity };

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
  useOptimistic,
  useActionState,
  useEffectEvent,
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
  Profiler,
  Activity,
  unstable_Activity: Activity,
  cache,
  captureOwnerStack,
  memo,
  lazy,
  act,
  Children,
  version,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
};

export default React;
