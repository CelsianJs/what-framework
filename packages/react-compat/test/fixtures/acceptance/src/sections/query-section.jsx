import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

async function fetchUser() {
  await new Promise((r) => setTimeout(r, 150));
  return { name: 'Ada Lovelace', role: 'engineer' };
}

function User() {
  const { data, isPending, isError, error } = useQuery({ queryKey: ['user'], queryFn: fetchUser });
  if (isPending) return <div id="q-loading">loading…</div>;
  if (isError) return <div id="q-error" className="error">{String(error)}</div>;
  return (
    <div id="q-data" data-status="pass">
      {data.name} ({data.role})
    </div>
  );
}

export function QuerySection() {
  return (
    <section id="query-section">
      <h2>3. @tanstack/react-query</h2>
      <QueryClientProvider client={client}>
        <User />
      </QueryClientProvider>
    </section>
  );
}
