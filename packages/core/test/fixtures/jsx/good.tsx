// Valid What JSX — must type-check clean under strict mode.
// Guards packages/core/jsx-runtime.d.ts (JSX.IntrinsicElements + runtime types).
import { signal } from 'what-framework';

function Counter() {
  const count = signal(0);
  return (
    <div class="counter" id="root">
      {/* reactive text child */}
      <span>{() => `Count: ${count()}`}</span>
      {/* lowercase + camelCase event handlers both valid */}
      <button onclick={() => count((c) => c + 1)}>inc</button>
      <button onClick={() => count((c) => c - 1)}>dec</button>
      {/* reactive attribute value */}
      <input type="text" value={() => String(count())} disabled={false} />
      <a href="/home" target="_blank">home</a>
      {/* data-/aria- and arbitrary attributes pass through */}
      <div data-testid="x" aria-label="y" custom-attr="z" />
      {/* SVG (recharts-style) */}
      <svg width={100} height={50}>
        <path d="M0 0 L10 10" stroke="red" fill="none" />
      </svg>
    </div>
  );
}

export default Counter;
