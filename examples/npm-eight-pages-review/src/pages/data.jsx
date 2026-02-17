import { invalidateQueries, useSWR } from 'what-framework';

export const page = {
  mode: 'client',
};

const CACHE_KEY = 'review-users';

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;

    if (signal.aborted) {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }

    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    }, { once: true });
  });
}

async function fakeUserFetch(key, { signal } = {}) {
  await wait(320, signal);

  const stamp = new Date().toLocaleTimeString();
  return [
    { id: 1, name: 'Ada', source: key, fetchedAt: stamp },
    { id: 2, name: 'Linus', source: key, fetchedAt: stamp },
    { id: 3, name: 'Ken', source: key, fetchedAt: stamp },
  ];
}

export default function DataPage() {
  const { data, error, isLoading, isValidating, mutate, revalidate } = useSWR(CACHE_KEY, fakeUserFetch, {
    dedupingInterval: 250,
  });

  const rows = data() || [];

  const addOptimisticRow = () => {
    mutate((current = []) => [
      ...current,
      {
        id: Date.now(),
        name: `Local-${current.length + 1}`,
        source: 'optimistic',
        fetchedAt: 'local-only',
      },
    ], false);
  };

  return (
    <section>
      <h1 class="page-title">SWR data fetching</h1>
      <p class="lead">Uses <code>useSWR</code>, <code>mutate</code>, <code>revalidate</code>, and <code>invalidateQueries</code>.</p>

      <div class="card">
        <div class="button-row">
          <button class="btn btn-primary" onClick={() => revalidate()}>Revalidate</button>
          <button class="btn" onClick={addOptimisticRow}>Optimistic add</button>
          <button class="btn" onClick={() => invalidateQueries(CACHE_KEY, { hard: true })}>Hard invalidate</button>
        </div>

        <p class="small-note">isLoading: <strong>{String(isLoading())}</strong> | isValidating: <strong>{String(isValidating())}</strong></p>

        {error() && <p class="warn-note">{String(error().message || error())}</p>}

        <ul class="stack-list">
          {rows.map((row) => (
            <li class="row">
              <span>{row.name}</span>
              <span class="meta">{row.source} @ {row.fetchedAt}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
