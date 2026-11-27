// Fixture: intentionally violates several what/* rules.
// Linted by flat-config.test.js with the SHIPPED recommended config and
// ZERO extra user configuration — proves the preset works out of the box.
import { signal } from 'what-framework';

const count = signal(0, 'count');
const isLoading = signal(false, 'isLoading');

export function Counter() {
  return (
    <div>
      {/* not a finding: a signal as the whole child is a live binding */}
      <span>{count}</span>
      {/* what/signal-call-in-jsx — a signal function is always truthy */}
      <p>{isLoading && <em>loading…</em>}</p>
      {/* not a finding: the runtime takes onClick as well as onclick */}
      <button onClick={() => count(count() + 1)}>Add</button>
    </div>
  );
}
