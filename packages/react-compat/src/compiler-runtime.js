/**
 * what-react/compiler-runtime: `react/compiler-runtime`, what a library
 * built with React Compiler imports. `c(size)` is the component's memo cache:
 * an array kept for the component's life, every slot holding the sentinel
 * until the compiled code fills it.
 */
import { _requireInstance, _getHookSlot } from './runtime.js';

const SENTINEL = Symbol.for('react.memo_cache_sentinel');

export function c(size) {
  const slot = _getHookSlot(_requireInstance('c'));
  if (!slot.init) {
    slot.init = true;
    slot.value = new Array(size).fill(SENTINEL);
  }
  return slot.value;
}
