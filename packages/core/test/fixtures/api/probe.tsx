// Valid What usage straight out of README/QUICKSTART/CLAUDE.md — must type-check
// clean under strict mode. Guards packages/core/index.d.ts against drift from
// the runtime signatures in packages/core/src/.
import {
  signal,
  computed,
  effect,
  hydrate,
  useLoaderData,
  getServerContext,
  getHealth,
  configureGuardrails,
  createWhatError,
  ERROR_CODES,
  WhatError,
  Show,
  For,
  Switch,
  Match,
  ErrorBoundary,
  type Component,
} from 'what-framework';

// The two-arg signal(initial, debugName) form is what every doc teaches.
const count = signal(0, 'count');
const doubled = computed(() => count() * 2);
effect(() => {
  void doubled();
});

const Greeting: Component<{ name: string }> = ({ name }) => <p>{name}</p>;

function App() {
  return (
    <div>
      <Greeting name="world" />
      <Show when={() => count() > 0} fallback={<span>none</span>}>
        <span>{() => count()}</span>
      </Show>
      <For each={() => [1, 2, 3]}>{(n: number) => <li>{n}</li>}</For>
      <Switch fallback={<span>fallback</span>}>
        <Match when={() => count() > 1}>
          <span>many</span>
        </Match>
      </Switch>
      <ErrorBoundary fallback={({ error }) => <span>{error.message}</span>}>
        <span>ok</span>
      </ErrorBoundary>
    </div>
  );
}

export function boot(container: Element) {
  hydrate(<App />, container);
  const data = useLoaderData<{ id: string }>();
  const ctx = getServerContext();
  const err: WhatError = createWhatError(ERROR_CODES.MISSING_SIGNAL_READ, { signalName: 'count' });
  configureGuardrails({ signalReadDetection: false });
  return { data, ctx, err, health: getHealth() };
}
