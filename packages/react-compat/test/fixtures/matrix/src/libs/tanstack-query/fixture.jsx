import { Suspense, useState } from 'react';
import { QueryClient, QueryClientProvider, useIsFetching, useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';

const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60000 } } });
let saved = 0;
const fetchList = async (page) => {
  const res = await fetch(`/api/list?n=${page}`);
  const json = await res.json();
  return [...json.items, `saved-${saved}`];
};

function List() {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['list', page], queryFn: () => fetchList(page), placeholderData: (prev) => prev });
  const fetching = useIsFetching();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => { await new Promise((r) => setTimeout(r, 20)); saved++; },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['list'] }),
  });
  return (
    <div>
      <span id="q-status">{query.status}</span>
      <span id="q-data">{query.data ? query.data.join(',') : ''}</span>
      <span id="q-fetching">{fetching}</span>
      <button id="q-next" onClick={() => setPage((p) => p + 1)}>page {page}</button>
      <button id="q-prev" onClick={() => setPage((p) => p - 1)}>back</button>
      <button id="q-save" onClick={() => mutation.mutate()}>{mutation.isPending ? 'saving' : 'save'}</button>
      <span id="q-mutation">{mutation.status}</span>
    </div>
  );
}

function Profile() {
  const { data } = useSuspenseQuery({ queryKey: ['profile'], queryFn: async () => (await (await fetch('/api/profile?n=9')).json()).items[1] });
  return <span id="q-profile">{data}</span>;
}

function Failing() {
  const query = useQuery({ queryKey: ['bad'], queryFn: async () => { throw new Error('nope'); } });
  return <span id="q-error">{query.isError ? query.error.message : query.status}</span>;
}

export default function Fixture() {
  return (
    <QueryClientProvider client={client}>
      <List />
      <Suspense fallback={<span id="q-fallback">loading</span>}>
        <Profile />
      </Suspense>
      <Failing />
    </QueryClientProvider>
  );
}
