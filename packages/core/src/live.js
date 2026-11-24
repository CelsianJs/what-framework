// --- live ---
// A live view of the object an accessor returns: `view.name` reads the
// accessor's CURRENT value and returns its `name`. JSX built once from the
// view follows a value replaced under the accessor (a keyed row's item after a
// refetch, a query's data after it revalidates) instead of being built again.
//
// The view is what What reads as live props (dom.js _isLiveProp): an object
// with no prototype whose properties are getters. `{view.name}` placed in JSX
// is a reactive child, `class={view.on ? 'a' : 'b'}` a reactive attribute,
// and `<Cell row={view} />` hands the view on. A getter is defined the first
// time its key is read on a value that has it as its own property (a Proxy:
// the keys of the value can change), so making the view reads nothing.
//
// A keyed row whose building code reads `view.id` records the field `id`, not
// the whole item (reactive.js _readKey, _rowItem): a replacement whose `id` is
// the same keeps the row and the state in it. Listing the view's keys (a
// spread, Object.keys, JSON.stringify) reads the whole value.

import { _readKey, untrack } from './reactive.js';

/**
 * @template {object} T
 * @param {() => T | null | undefined} source
 * @returns {T}
 */
export function live(source) {
  if (typeof source !== 'function') throw new TypeError('live(source): source must be a function that returns the current value');
  const target = Object.create(null);
  const current = (key) => _readKey(key, source);
  // Whether the value has a field is a question, not a read of it: a keyed row
  // checking a prop's liveness (_isLiveProp) records nothing, and the region
  // or binding asking (render.js _place, where it checks a live prop) does not
  // come to depend on the whole value, which would build it again whenever
  // any field changed.
  const peek = () => untrack(() => _readKey(null, source));
  const define = (key) => {
    if (!Object.hasOwn(target, key) && Object.isExtensible(target)) {
      Object.defineProperty(target, key, {
        get: () => {
          const value = current(key);
          return value == null ? undefined : value[key];
        },
        enumerable: true,
        configurable: true,
      });
    }
  };
  return new Proxy(target, {
    get(t, key) {
      if (typeof key !== 'string') return undefined;
      const value = current(key);
      if (value == null) return undefined;
      if (Object.hasOwn(value, key)) define(key);
      return value[key];
    },
    getOwnPropertyDescriptor(t, key) {
      if (typeof key !== 'string') return undefined;
      // A key defined once stays reported: a frozen view may not lose one.
      if (!Object.hasOwn(t, key)) {
        const value = peek();
        if (value == null || !Object.hasOwn(value, key)) return undefined;
        define(key);
      }
      return Reflect.getOwnPropertyDescriptor(t, key);
    },
    has(t, key) {
      if (typeof key !== 'string') return false;
      const value = peek();
      return (value != null && key in Object(value)) || Object.hasOwn(t, key);
    },
    ownKeys(t) {
      const value = source();
      if (value != null) for (const key of Object.keys(value)) define(key);
      return Reflect.ownKeys(t);
    },
    set() {
      return false;
    },
  });
}
