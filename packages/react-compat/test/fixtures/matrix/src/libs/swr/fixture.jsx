import { useState } from 'react';
import useSWR, { SWRConfig, useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';

let fetches = 0;
const fetcher = async (url) => {
  fetches++;
  const res = await fetch(url);
  return (await res.json()).items;
};

function Items({ id }) {
  const { data, error, isLoading } = useSWR(`/api/swr?n=${id}`, fetcher);
  return <span id={`s-items-${id}`}>{error ? 'error' : isLoading ? 'loading' : data.join(',')}</span>;
}

function Panel() {
  const [n, setN] = useState(1);
  const { mutate } = useSWRConfig();
  const { data, mutate: mutateLocal } = useSWR(`/api/swr?n=${n}`, fetcher);
  const { trigger, isMutating, data: sent } = useSWRMutation('/api/send', async (url, { arg }) => {
    const res = await fetch(`${url}?n=${arg}`);
    return (await res.json()).n;
  });
  return (
    <div>
      <span id="s-data">{data ? data.join(',') : 'loading'}</span>
      <span id="s-fetches">{fetches}</span>
      <button id="s-next" onClick={() => setN(n + 1)}>key {n}</button>
      <button id="s-optimistic" onClick={() => mutateLocal(['local'], { revalidate: false })}>set local</button>
      <button id="s-revalidate" onClick={() => mutate(`/api/swr?n=${n}`)}>revalidate</button>
      <button id="s-send" onClick={() => trigger(42)}>{isMutating ? 'sending' : 'send'}</button>
      <span id="s-sent">{String(sent)}</span>
    </div>
  );
}

export default function Fixture() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 60000, revalidateOnFocus: false }}>
      <Items id={1} />
      <Items id={1} />
      <Panel />
    </SWRConfig>
  );
}
