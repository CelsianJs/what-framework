import { rpc } from 'virtual:then-rpc-client';

export const page = { mode: 'server' };

export default function UserProfile({ params }) {
  const { data, isLoading } = rpc.user.getById.useSWR({ id: params.id });

  if (isLoading()) return <p>Loading...</p>;

  return (
    <main>
      <h1>{data()?.name}</h1>
      <p>{data()?.email}</p>
      <a href="/">Back to list</a>
    </main>
  );
}
