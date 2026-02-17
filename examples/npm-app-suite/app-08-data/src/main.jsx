import { mount, useSWR } from 'what-framework';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchStats() {
  await sleep(220);
  return {
    usersOnline: 80 + Math.floor(Math.random() * 20),
    requestsPerMin: 900 + Math.floor(Math.random() * 250),
    errorRate: Number((Math.random() * 1.4).toFixed(2)),
    at: new Date().toLocaleTimeString(),
  };
}

function App() {
  const swr = useSWR('demo:stats', fetchStats, { dedupingInterval: 50 });

  return (
    <main className="app-shell">
      <h1>App 08: SWR Data</h1>
      <p>Shared cache signals, explicit revalidate, and optimistic mutate path.</p>

      <div className="row">
        <button onClick={() => swr.revalidate()}>Revalidate</button>
        <button
          onClick={() =>
            swr.mutate((prev) => ({
              ...(prev || {}),
              usersOnline: (prev?.usersOnline || 0) + 1,
              at: 'optimistic',
            }))
          }
        >
          Optimistic +1 user
        </button>
      </div>

      {swr.error() ? <p className="error">{String(swr.error())}</p> : null}
      {swr.isLoading() ? <p>Loading...</p> : null}

      <pre>{JSON.stringify(swr.data(), null, 2)}</pre>
      <p className="meta">Validating: {String(swr.isValidating())}</p>
    </main>
  );
}

mount(<App />, '#app');
