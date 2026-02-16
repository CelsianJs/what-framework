// Mock data and fetcher functions for Data Table

const USERS = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `User ${i + 1}`,
  email: `user${i + 1}@example.com`,
  role: ['Admin', 'Editor', 'Viewer'][i % 3],
  status: ['Active', 'Inactive', 'Pending'][i % 3],
  joinDate: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toISOString(),
  lastActive: new Date(2025, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toISOString(),
}));

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Paginated fetcher for useSWR
export async function fetchUsers(key, { signal } = {}) {
  await delay(800);
  const params = new URLSearchParams(key.split('?')[1] || '');
  const page = parseInt(params.get('page') || '1');
  const q = (params.get('q') || '').toLowerCase();
  const sort = params.get('sort') || 'id';
  const dir = params.get('dir') || 'asc';
  const pageSize = 10;

  let filtered = USERS.filter(u =>
    !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q)
  );

  filtered.sort((a, b) => {
    let aVal = a[sort];
    let bVal = b[sort];

    // Handle numeric comparison for id
    if (sort === 'id') {
      aVal = Number(aVal);
      bVal = Number(bVal);
    }

    // Handle date comparison
    if (sort === 'joinDate' || sort === 'lastActive') {
      aVal = new Date(aVal).getTime();
      bVal = new Date(bVal).getTime();
    }

    // Handle string comparison
    if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase();
      bVal = bVal.toLowerCase();
    }

    if (aVal < bVal) return dir === 'asc' ? -1 : 1;
    if (aVal > bVal) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  const start = (page - 1) * pageSize;
  return {
    users: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    totalPages: Math.ceil(filtered.length / pageSize),
  };
}

// Stats fetcher for useQuery
export async function fetchStats() {
  await delay(500);
  return {
    totalUsers: USERS.length,
    activeUsers: USERS.filter(u => u.status === 'Active').length,
    inactiveUsers: USERS.filter(u => u.status === 'Inactive').length,
    pendingUsers: USERS.filter(u => u.status === 'Pending').length,
    admins: USERS.filter(u => u.role === 'Admin').length,
    editors: USERS.filter(u => u.role === 'Editor').length,
    viewers: USERS.filter(u => u.role === 'Viewer').length,
  };
}

// Infinite scroll fetcher
export async function fetchUsersInfinite({ pageParam = 0 }) {
  await delay(600);
  const pageSize = 20;
  const users = USERS.slice(pageParam, pageParam + pageSize);
  return {
    users,
    nextCursor: pageParam + pageSize < USERS.length ? pageParam + pageSize : undefined,
  };
}
