import { mount, useSignal, useSWR } from 'what-framework';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let shouldError = false;

async function fetchUsers(_key) {
  await sleep(400);
  if (shouldError) throw new Error('Server error');
  return [
    { id: 1, name: 'Ada Lovelace', role: 'Admin', status: 'active' },
    { id: 2, name: 'Linus Torvalds', role: 'Developer', status: 'active' },
    { id: 3, name: 'Grace Hopper', role: 'Manager', status: 'inactive' },
    { id: 4, name: 'Alan Turing', role: 'Developer', status: 'active' },
    { id: 5, name: 'Margaret Hamilton', role: 'Lead', status: 'active' },
  ];
}

async function fetchStats(_key) {
  await sleep(200);
  if (shouldError) throw new Error('Stats unavailable');
  return {
    activeUsers: 4,
    requestsPerMin: 900 + Math.floor(Math.random() * 300),
    errorRate: (Math.random() * 2).toFixed(2),
    uptime: '99.9%',
    refreshedAt: new Date().toLocaleTimeString(),
  };
}

async function fetchDetail(key) {
  const id = Number(key.split(':')[1]);
  await sleep(300);
  const details = {
    1: { name: 'Ada Lovelace', email: 'ada@example.com', role: 'Admin', bio: 'Pioneer of computing' },
    2: { name: 'Linus Torvalds', email: 'linus@example.com', role: 'Developer', bio: 'Created Linux' },
    3: { name: 'Grace Hopper', email: 'grace@example.com', role: 'Manager', bio: 'First compiler' },
    4: { name: 'Alan Turing', email: 'alan@example.com', role: 'Developer', bio: 'Father of CS' },
    5: { name: 'Margaret Hamilton', email: 'margaret@example.com', role: 'Lead', bio: 'Apollo software' },
  };
  return details[id] || null;
}

function App() {
  const selectedId = useSignal(null);
  const errorMode = useSignal(false);

  const users = useSWR('dashboard:users', fetchUsers, { dedupingInterval: 200 });
  const stats = useSWR('dashboard:stats', fetchStats, { dedupingInterval: 200 });

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>API Cache Dashboard</h1>
        <div className="header-actions">
          <button
            className="btn btn-primary"
            data-testid="refresh-btn"
            onClick={() => {
              users.revalidate();
              stats.revalidate();
            }}
          >
            Refresh All
          </button>
          <button
            className="btn btn-outline"
            data-testid="error-btn"
            onClick={() => {
              shouldError = true;
              errorMode.set(true);
              users.revalidate();
              stats.revalidate();
            }}
          >
            {errorMode() ? 'Errors ON' : 'Simulate Errors'}
          </button>
        </div>
      </header>

      <section className="stats-panel" data-testid="stats-panel">
        <h2>Live Stats</h2>
        {stats.isLoading() ? (
          <p data-testid="loading-indicator">Loading stats...</p>
        ) : stats.error() ? (
          <p className="error-box" data-testid="error-message">{String(stats.error())}</p>
        ) : (
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Active Users</span>
              <span className="stat-value" data-testid="stats-value">{stats.data()?.activeUsers}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Req/min</span>
              <span className="stat-value" data-testid="stats-value">{stats.data()?.requestsPerMin}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Error Rate</span>
              <span className="stat-value" data-testid="stats-value">{stats.data()?.errorRate}%</span>
            </div>
          </div>
        )}
      </section>

      <div className="main-content">
        <section className="user-list-section">
          <h2>Users</h2>
          {users.isLoading() ? (
            <p data-testid="loading-indicator">Loading users...</p>
          ) : users.error() ? (
            <p className="error-box" data-testid="error-message">{String(users.error())}</p>
          ) : (
            <ul className="user-list" data-testid="user-list">
              {(users.data() || []).map((user) => (
                <li
                  key={user.id}
                  className={`user-item ${selectedId() === user.id ? 'selected' : ''}`}
                  data-testid={`user-item-${user.id}`}
                  onClick={() => selectedId.set(selectedId() === user.id ? null : user.id)}
                >
                  <span className="user-name">{user.name}</span>
                  <span className="user-role">{user.role}</span>
                  <span className={`badge badge-${user.status}`}>{user.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div data-testid="user-detail" className="detail-panel">
          {selectedId() ? (
            <UserDetailInner id={selectedId()} />
          ) : (
            <p>Select a user to view details</p>
          )}
        </div>
      </div>
    </div>
  );
}

function UserDetailInner({ id }) {
  const detail = useSWR(`detail:${id}`, fetchDetail, { dedupingInterval: 200 });

  if (detail.isLoading()) return <p data-testid="loading-indicator">Loading detail...</p>;
  if (detail.error()) return <p className="error-box" data-testid="error-message">{String(detail.error())}</p>;

  const d = detail.data();
  if (!d) return <p>User not found</p>;

  return (
    <div>
      <h3>{d.name}</h3>
      <p><strong>Email:</strong> {d.email}</p>
      <p><strong>Role:</strong> {d.role}</p>
      <p><strong>Bio:</strong> {d.bio}</p>
    </div>
  );
}

mount(<App />, '#app');
