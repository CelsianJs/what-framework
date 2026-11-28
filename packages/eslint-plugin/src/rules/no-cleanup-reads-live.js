/**
 * Rule: what/no-cleanup-reads-live (ERR_CLEANUP_READS_LIVE)
 *
 * A useEffect cleanup that reads a prop or state its run also reads, in an
 * effect that runs again: the cleanup sees the new value
 * (`return () => leave(props.room)` leaves the new room).
 * what-compiler reports the same shape at build time; this rule is for
 * code it does not build (the islands template's automatic JSX runtime, h()
 * files), so the `compiler` preset turns it off. See utils/read-once.js.
 */

import { readOnceRule } from '../utils/read-once.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'A useEffect cleanup that reads a prop or state its run also reads',
      recommended: true,
      code: 'ERR_CLEANUP_READS_LIVE',
    },
    messages: {
      readOnce: 'The useEffect cleanup in <{{component}}> reads `{{name}}`, which its run reads too: {{why}}. Fix: {{fix}}.',
    },
    schema: [],
  },

  create(context) {
    return readOnceRule('ERR_CLEANUP_READS_LIVE', context);
  },
};
