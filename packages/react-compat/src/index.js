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
import { isVNode } from 'what-core/internal';
import { getBridge, _getCurrentInstance, flushUpdates, _drainAll, _setRangeHidden, _componentStack, _isStuck, _vnodeOf } from './runtime.js';
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

// React's Fragment is a symbol, and `react-is` (inside MUI, Ant Design,
// react-redux and others) recognises a fragment element by it. An element
// made with what-core's Fragment (the mixed compiler's `<>`, a file that
// imports it from what-framework) carries the same symbol as its type.
const REACT_FRAGMENT_TYPE = Symbol.for('react.fragment');
export const Fragment = REACT_FRAGMENT_TYPE;

function FragmentComponent(props) {
  return props.children;
}
FragmentComponent.displayName = 'Fragment';
// Not a frame of its own in a component stack.
FragmentComponent._hidden = true;
const fragmentBridge = getBridge(FragmentComponent);

// ---- Class components ----

// A class component extends Component or PureComponent (below), whose
// definition installs the wrapper that renders one: a program that never
// defines a class component (it does not have Component in it) does not
// carry the class lifecycle. React itself renders as a class only what has
// `isReactComponent` on its prototype, which is Component's.
/** @type {((type: any) => any) | null} */
let classWrapper = null;

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
        // `origin`: the instance whose render or effect threw (the runtime
        // passes it; the instance type in types/internal.d.ts declares one
        // argument, hence the cast).
        inst._errorHandler = /** @type {(error: any) => void} */ (/** @type {unknown} */ ((error, origin) => {
          if (ClassComp.getDerivedStateFromError) {
            const derived = ClassComp.getDerivedStateFromError(error);
            if (derived != null) instance.state = { ...instance.state, ...derived };
          }
          if (instance.componentDidCatch) {
            // The components from the one that threw up to the root, one
            // "at Name" line each (React's production format, without host
            // elements and source locations).
            try { instance.componentDidCatch(error, { componentStack: origin ? _componentStack(origin) : '' }); } catch { /* boundary error */ }
          }
          instance._forced = true;
          forceRender();
        }));
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

    // componentDidUpdate with the snapshot (taken below, after render()),
    // then the callbacks setState and forceUpdate were given.
    const updated = update && !mounting && last !== undefined;
    let snapshot;
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
    // getSnapshotBeforeUpdate: after render() and before this component's
    // DOM changes (the reconciler patches it once this function returns).
    if (updated && instance.getSnapshotBeforeUpdate) snapshot = instance.getSnapshotBeforeUpdate(last.props, last.state);
    instance._last = { props: mergedProps, state, output };
    return output;
  };

  wrapper.displayName = ClassComp.displayName || ClassComp.name || 'ClassComponent';
  // Copy static properties (defaultProps, contextType, custom statics)
  for (const key of Object.getOwnPropertyNames(ClassComp)) {
    if (key !== 'prototype' && key !== 'length' && key !== 'name' && key !== 'caller' && key !== 'arguments' && key !== '_compatBridge') {
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
// what-core's Fragment is not branded (it is the framework's own export):
// what-react's Fragment is React's symbol, and an element made with core's
// takes the symbol as its type (above). Context is branded where it is
// created (hooks.js).
const REACT_ELEMENT_TYPE = Symbol.for('react.element');
const REACT_MEMO_TYPE = Symbol.for('react.memo');
const REACT_LAZY_TYPE = Symbol.for('react.lazy');
const REACT_SUSPENSE_TYPE = Symbol.for('react.suspense');
const REACT_CONTEXT_TYPE = Symbol.for('react.context');

export function createElement(type, props, ...children) {
  if (props == null) props = {};
  // React's rule for props.children: the one child, or the array of them.
  if (children.length > 0) props = { ...props, children: children.length === 1 ? children[0] : children };
  return _element(type, props, undefined);
}

/**
 * The element for `type` with `props` as React holds them: `props.children`
 * is the child (or the array of children), untouched, so an array a caller
 * memoized keeps its identity. createElement and the JSX runtime end here.
 * `key`: the element's key when it is not in `props` (the automatic JSX
 * runtime hands it over apart, and the props are then used as they are, not
 * copied to carry it).
 */
export function _element(type, props, key) {
  // Resolve the render target and vnode tag:
  // - vnode.type stays the ORIGINAL component (libraries compare element.type)
  // - vnode.tag is the What-native bridge so core's renderer can also render
  //   compat vnodes; the compat runtime unwraps tag._compatType.
  let tag = type;
  if (typeof type === 'function') {
    if (type === WhatFragment) {
      type = REACT_FRAGMENT_TYPE;
      tag = fragmentBridge;
    } else {
      tag = type._compatBridge;
      if (tag === undefined || tag._compatFor !== type) tag = bridgeOf(type);
      // React resolves defaultProps when the element is made, for every
      // component type: a default stands in for a prop that is undefined.
      const defaults = type.defaultProps;
      if (defaults != null) props = withDefaults(props, defaults);
    }
  } else if (typeof type === 'string') {
    if (props.class !== undefined && props.className !== undefined) {
      // `className` and `htmlFor` stay in the props under React's names (a
      // library that merges a child's props reads `child.props.className`);
      // both renderers write either spelling. An element given both spellings
      // of the class (a merge of `class` with a library's `className`) keeps
      // React's.
      props = { ...props };
      delete props.class;
    }
  } else if (type === REACT_FRAGMENT_TYPE) {
    tag = fragmentBridge;
  } else if (type !== null && typeof type === 'object' && type.$$typeof === REACT_CONTEXT_TYPE && typeof type.Provider === 'function') {
    // React 19: a context renders as its own provider (<Theme value="dark">).
    tag = getBridge(type.Provider);
  } else {
    console.error('[what-react] createElement: invalid element type:', type);
  }

  // The child list: the children, or the array passed as the only child (a
  // `.map()` list). An array inside the list stays one: the runtime
  // reconciles it as a list of its own, so the children after it keep their
  // slots when it grows (React gives a nested array a fragment).
  const only = props.children;
  const kids = only === undefined ? EMPTY_CHILDREN : Array.isArray(only) ? only : [only];

  // A vnode as h() makes it (runtime.js _vnodeOf takes `key` out of the
  // props), with this module's child list, which keeps the holes the runtime
  // reconciles by position and h() would drop.
  // `ref` is a prop (React 19) and is on the element too, where React 18 and
  // the libraries written for it read it (`element.ref`).
  const vnode = /** @type {any} */ (_vnodeOf(tag, props));
  if (key !== undefined) vnode.key = key;
  vnode.$$typeof = REACT_ELEMENT_TYPE;
  vnode.type = type;
  vnode.ref = props.ref !== undefined ? props.ref : null;
  vnode.children = kids;
  vnode._compat = true;
  return vnode;
}

// The bridge of a component (runtime.js getBridge), kept on the component so
// making an element looks nothing up. The bridge names the component it is
// for: a class that inherits the property from its parent class, or a
// wrapper a library copied a component's statics onto, gets its own.
function bridgeOf(type) {
  const bridge = getBridge(classWrapper !== null && isClassComponent(type) ? classWrapper(type) : type);
  bridge._compatFor = type;
  try {
    Object.defineProperty(type, '_compatBridge', { value: bridge, configurable: true, writable: true });
  } catch { /* a frozen component: looked up each time */ }
  return bridge;
}

// `props` with `defaults` standing in for the props that are undefined (the
// same object when none is).
function withDefaults(props, defaults) {
  let out = props;
  for (const name in defaults) {
    if (props[name] === undefined) {
      if (out === props) out = { ...props };
      out[name] = defaults[name];
    }
  }
  return out;
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
  // React's forwardRef object carries the function it wraps; libraries that
  // wrap a forwardRef component again read it (mobx-react's observer).
  ForwardRefComponent.render = render;
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
  const render = classWrapper !== null && isClassComponent(Component) ? classWrapper(Component) : Component;
  function Memoized(props) {
    // The wrapped component's own defaultProps (the memo's are resolved
    // when the element is made).
    const defaults = Component.defaultProps;
    return render(defaults != null ? withDefaults(props, defaults) : props);
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
//
// The components below carry their statics from where they are made (a
// marked-pure Object.assign), not from assignments at module scope, which a
// bundler keeps whether or not the component is used.
export const Suspense = /* @__PURE__ */ Object.assign(function Suspense(props) {
  const inst = _getCurrentInstance();
  if (inst) inst._isSuspense = true;
  const suspended = inst != null && (inst._suspendCount ?? 0) > 0;
  const fallback = props.fallback !== undefined ? props.fallback : null;
  if (suspended && inst._keepPrimary !== true) return [null, fallback];
  return [createElement(SuspenseContent, { hidden: suspended }, props.children), suspended ? fallback : null];
}, { displayName: 'Suspense', $$typeof: REACT_SUSPENSE_TYPE });

const SuspenseContent = /* @__PURE__ */ Object.assign(function SuspenseContent(props) {
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
}, { displayName: 'SuspenseContent', _hidden: true });

// ---- Children utilities ----

// React's rules: a nested array (or any iterable) is walked in place; null,
// undefined and booleans are one empty child each, handed to the callback as
// null and counted by count(); what the callback returns is flattened, and
// each element in the result gets React's key for the child it came from, so
// a list a library rebuilt with map() or toArray() keeps its children's
// identity (and their state) when one of them comes or goes.
//
// The key is the child's path: '.' + its key or index at the top level, and
// ':' + its key or index for each nested array ('.1:0', '.1:$x'). A child's
// own key is written '$key' with '=' and ':' escaped ('=0', '=2'), an index
// in base 36. A key the callback gave its result goes in front, before '/'.

function escapeKey(key) {
  return '$' + key.replace(/[=:]/g, (match) => (match === '=' ? '=0' : '=2'));
}

function escapeUserKey(text) {
  return text.replace(/\/+/g, '$&/');
}

function keyOf(child, index) {
  return typeof child === 'object' && child !== null && child.key != null ? escapeKey('' + child.key) : index.toString(36);
}

function isList(children) {
  return children !== null && typeof children === 'object' && !isValidElement(children) && typeof children[Symbol.iterator] === 'function';
}

function identity(child) {
  return child;
}

// React's mapIntoArray. Returns the number of children visited.
function mapInto(children, out, escapedPrefix, nameSoFar, callback) {
  if (Array.isArray(children) || isList(children)) {
    const prefix = nameSoFar === '' ? '.' : nameSoFar + ':';
    let count = 0;
    let index = 0;
    for (const child of children) {
      count += mapInto(child, out, escapedPrefix, prefix + keyOf(child, index), callback);
      index++;
    }
    return count;
  }
  const child = children == null || typeof children === 'boolean' ? null : children;
  let mapped = callback(child);
  const childKey = nameSoFar === '' ? '.' + keyOf(child, 0) : nameSoFar;
  if (Array.isArray(mapped)) {
    mapInto(mapped, out, escapeUserKey(childKey) + '/', '', identity);
  } else if (mapped != null) {
    if (isValidElement(mapped)) {
      // A key the callback gave its result, kept in front of the child's.
      const own = mapped.key != null && (child === null || typeof child !== 'object' || child.key !== mapped.key) ? escapeUserKey('' + mapped.key) + '/' : '';
      mapped = cloneElement(mapped, { key: escapedPrefix + own + childKey });
    }
    out.push(mapped);
  }
  return 1;
}

function walkChildren(children, visit) {
  if (Array.isArray(children) || isList(children)) {
    for (const child of children) walkChildren(child, visit);
    return;
  }
  visit(children == null || typeof children === 'boolean' ? null : children);
}

export const Children = {
  map(children, fn, thisArg) {
    if (children == null) return children;
    const result = [];
    let index = 0;
    mapInto(children, result, '', '', (child) => fn.call(thisArg, child, index++));
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
    return Children.map(children, identity) || [];
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

export const StrictMode = /* @__PURE__ */ Object.assign(function StrictMode(props) {
  return props.children;
}, { displayName: 'StrictMode' });

// Renders its children; nothing is measured (onRender is never called).
export const Profiler = /* @__PURE__ */ Object.assign(function Profiler(props) {
  return props.children;
}, { displayName: 'Profiler' });

// React 19.2. `hidden` renders nothing here: React keeps the hidden tree's
// state and DOM, this unmounts it (see REACT-COMPAT.md, known limitations).
export const Activity = /* @__PURE__ */ Object.assign(function Activity(props) {
  return props.mode === 'hidden' ? null : props.children;
}, { displayName: 'Activity' });

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
// Component.call(this, props) works alongside native class extends. Each is
// made by a marked-pure call: a program that defines no class component
// drops them, and with Component the class wrapper (getClassWrapper above),
// which Component's definition installs.

/**
 * @typedef {{ props: any, state: any, context: any, _mounted: boolean, _enqueue: (() => void) | null, [key: string]: any }} ClassInstance
 */

export const Component = /* @__PURE__ */ (() => {
  /**
   * @this {ClassInstance}
   * @param {any} props
   * @param {any} [context]
   */
  function Component(props, context) {
    this.props = props;
    this.context = context;
    this.state = {};
    this._mounted = false;
    this._enqueue = null;
  }

  Component.prototype.isReactComponent = {};

  /** @this {ClassInstance} */
  Component.prototype.setState = function (update, callback) {
    // Refused while the update-loop guard holds this component (runtime.js).
    if (this._compatInst != null && _isStuck(this._compatInst)) return;
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

  /** @this {ClassInstance} */
  Component.prototype.forceUpdate = function (callback) {
    // Skips shouldComponentUpdate, as in React.
    this._forced = true;
    if (callback) (this._callbacks || (this._callbacks = [])).push(callback);
    if (this._enqueue) this._enqueue();
  };

  Component.prototype.render = function () {
    return null;
  };

  classWrapper = getClassWrapper;
  return Component;
})();

export const PureComponent = /* @__PURE__ */ (() => {
  /**
   * @this {ClassInstance}
   * @param {any} props
   * @param {any} [context]
   */
  function PureComponent(props, context) {
    Component.call(this, props, context);
  }

  PureComponent.prototype = Object.create(Component.prototype);
  PureComponent.prototype.constructor = PureComponent;
  PureComponent.prototype.isPureReactComponent = true;
  return PureComponent;
})();

// ---- Internal helpers ----

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  // Own enumerable keys, as Object.keys lists them, without the two arrays
  // (a memo row is compared on every render of its list).
  let count = 0;
  for (const key in a) {
    if (!hasOwn.call(a, key)) continue;
    if (!hasOwn.call(b, key) || !Object.is(a[key], b[key])) return false;
    count++;
  }
  for (const key in b) {
    if (hasOwn.call(b, key)) count--;
  }
  return count === 0;
}

const hasOwn = Object.prototype.hasOwnProperty;

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
