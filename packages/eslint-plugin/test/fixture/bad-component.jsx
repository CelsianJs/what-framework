// Fixture: intentionally violates several what/* rules.
// Linted by flat-config.test.js with the SHIPPED recommended config and
// ZERO extra user configuration — proves the preset works out of the box.
import { signal } from 'what-framework';

const count = signal(0, 'count');
const isLoading = signal(false, 'isLoading');

export function Counter() {
  return (
    <div>
      {/* what/signal-call-in-jsx — bare signal reference */}
      <span>{count}</span>
      {/* what/signal-call-in-jsx (logical) — signal fn always truthy */}
      <p>{isLoading && <em>loading…</em>}</p>
      {/* what/no-camelcase-events — What uses lowercase DOM events */}
      <button onClick={() => count(count() + 1)}>Add</button>
    </div>
  );
}
