/**
 * Rule: what/no-prop-read-once (ERR_PROP_READ_ONCE)
 *
 * A prop read once where React reads it on every render: a component whose
 * return is decided by a prop (`if (!props.open) return null`) keeps the
 * branch it took first.
 * what-compiler reports the same shape at build time; this rule is for
 * code it does not build (the islands template's automatic JSX runtime, h()
 * files), so the `compiler` preset turns it off. See utils/read-once.js.
 */

import { readOnceRule } from '../utils/read-once.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'A prop read once where React reads it on every render: a return decided by a prop',
      recommended: true,
      code: 'ERR_PROP_READ_ONCE',
    },
    messages: {
      readOnce: '`{{name}}`, a prop of <{{component}}>, is read once: {{why}}. Fix: {{fix}}.',
    },
    schema: [],
  },

  create(context) {
    return readOnceRule('ERR_PROP_READ_ONCE', context);
  },
};
