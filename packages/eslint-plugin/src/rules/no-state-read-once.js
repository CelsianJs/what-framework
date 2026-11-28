/**
 * Rule: what/no-state-read-once (ERR_STATE_READ_ONCE)
 *
 * State read once where React reads it on every render: a return decided by
 * the component's own state (`if (loading()) return <Spinner />`), or a value
 * derived from it in the body and shown in JSX (`const valid = name().length
 * > 0` with `disabled={!valid}`).
 * what-compiler reports the same shape at build time; this rule is for
 * code it does not build (the islands template's automatic JSX runtime, h()
 * files), so the `compiler` preset turns it off. See utils/read-once.js.
 */

import { readOnceRule } from '../utils/read-once.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'State read once where React reads it on every render: a return decided by it, or a value derived from it in the body and shown in JSX',
      recommended: true,
      code: 'ERR_STATE_READ_ONCE',
    },
    messages: {
      readOnce: '`{{name}}`, state of <{{component}}>, is read once: {{why}}. Fix: {{fix}}.',
    },
    schema: [],
  },

  create(context) {
    return readOnceRule('ERR_STATE_READ_ONCE', context);
  },
};
