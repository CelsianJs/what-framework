// Bindings the import arm of the lowering-parity fuzzer imports.
//
// The compiler sees an import only by name. It cannot tell a string constant
// from a signal from a plain function, so every one of those has to lower to
// something that means what the same value means in an h() tree. The pool has
// one of each kind a real module exports. Both arms import THIS module, so a
// write to a signal here moves both trees at once and any difference is in how
// the importing call site was lowered.

import { signal, computed } from '../../../core/src/index.js';

export const STR = '/docs';
export const NUM = 7;
export const NIL = null;
export const sig = signal('i0');
export const comp = computed(() => `c:${sig()}`);
export function fn() { return `f:${sig()}`; }
export default 'dflt';

export function resetImports() { sig('i0'); }
export function writeImports() { sig('i1'); }
