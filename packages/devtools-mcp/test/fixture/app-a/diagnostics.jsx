import { computed, effect, h, hydrate, signal, startTransition, Suspense, useOptimistic } from 'what-framework';

function AsyncWork() {
  const key = signal(0);
  const [optimistic, addOptimistic] = useOptimistic(key);
  let resolve;
  const result = computed(async () => {
    const value = key();
    await new Promise((done) => { resolve = done; });
    return value;
  });
  return <>
    <button id="land" onClick={() => resolve()}>Land result</button>
    <button id="hold" onClick={() => startTransition(() => { addOptimistic(1); key(1); })}>Start transition</button>
    <p>{optimistic()}</p>
    <Suspense fallback={<p id="waiting">Waiting</p>}><p id="async-value">{result()}</p></Suspense>
  </>;
}

function HydrationMismatch() {
  return [h('p', {}, 'client'), h('strong', {}, 'new')];
}

export function DiagnosticsExample() {
  const count = signal(0);
  const equal = computed(() => Math.floor(count() / 2));
  const formatted = computed(() => `value: ${equal()}`);
  const writtenByEffect = signal('');
  effect(function writeResult() { writtenByEffect(formatted()); });
  function mismatch() {
    const host = document.querySelector('#hydrate-target');
    host.innerHTML = '<p>server</p><aside>extra</aside>';
    hydrate(h(HydrationMismatch), host);
  }
  return <section>
    <button id="cause-click" onClick={() => count((value) => value + 1)}>Change source</button>
    <p id="cause-output" title={writtenByEffect()}>{writtenByEffect()}</p>
    <button id="hydrate-mismatch" onClick={mismatch}>Hydrate</button>
    <div id="hydrate-target" />
    <AsyncWork />
  </section>;
}
