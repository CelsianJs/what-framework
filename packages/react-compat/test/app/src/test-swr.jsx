/**
 * Test: SWR — React hooks for data fetching by Vercel
 * 1.2M weekly downloads. Primarily useSWR hook.
 */
import useSWR from 'swr';

// Mock fetcher that returns data after a delay
const fetcher = (url) =>
  new Promise((resolve) =>
    setTimeout(() => {
      if (url === '/api/user') {
        resolve({ name: 'Jane Doe', email: 'jane@example.com', plan: 'Pro' });
      } else if (url === '/api/repos') {
        resolve([
          { id: 1, name: 'what-framework', stars: 342 },
          { id: 2, name: 'celsian-server', stars: 128 },
          { id: 3, name: 'thenjs', stars: 89 },
        ]);
      }
    }, 500)
  );

function UserProfile() {
  const { data, error, isLoading } = useSWR('/api/user', fetcher);

  if (isLoading) return <p>Loading user...</p>;
  if (error) return <p style={{ color: 'red' }}>Error loading user</p>;

  return (
    <div style={{ padding: '8px', background: '#f9fafb', borderRadius: '6px', marginBottom: '8px' }}>
      <strong>{data.name}</strong> — {data.email} ({data.plan})
    </div>
  );
}

function RepoList() {
  const { data, isLoading } = useSWR('/api/repos', fetcher);

  if (isLoading) return <p>Loading repos...</p>;

  return (
    <ul style={{ margin: 0, paddingLeft: '20px' }}>
      {(data || []).map(repo => (
        <li key={repo.id}>{repo.name} — {repo.stars} stars</li>
      ))}
    </ul>
  );
}

export function SWRTest() {
  return (
    <div>
      <UserProfile />
      <RepoList />
      <p style={{ color: 'green' }} id="swr-status">SWR loaded OK</p>
    </div>
  );
}
