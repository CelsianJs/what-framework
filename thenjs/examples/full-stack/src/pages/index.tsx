import { rpc } from 'virtual:then-rpc-client';

export const page = { mode: 'server' };

export default function Home() {
  const { data, isLoading, error } = rpc.user.list.useSWR({});

  if (isLoading()) return <p>Loading users...</p>;
  if (error()) return <p>Error: {error().message}</p>;

  return (
    <main>
      <h1>Users</h1>
      <ul>
        {data()?.map(user => (
          <li key={user.id}>{user.name} — {user.email}</li>
        ))}
      </ul>
    </main>
  );
}
