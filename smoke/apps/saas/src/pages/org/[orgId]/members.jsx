// The org's 2,000 members in one table: sorted by any column, either way,
// and filtered as the visitor types.

import { computed, useState } from 'what-framework';
import { keys, useMembers } from '../../../queries.js';
import { loadPage } from '../../../loaders.js';

export const loader = (ctx) => loadPage(ctx, (db) => [
  [keys.org(ctx.params.orgId), db.org(ctx.params.orgId)],
  [keys.members(ctx.params.orgId), db.members(ctx.params.orgId)],
]);

const COLUMNS = [
  { id: 'name', label: 'Name' },
  { id: 'email', label: 'Email' },
  { id: 'role', label: 'Role' },
  { id: 'team', label: 'Team' },
  { id: 'active', label: 'Last active' },
];

const day = (t) => new Date(t).toISOString().slice(0, 10);

export default function Members({ params }) {
  const members = useMembers(() => params.orgId);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState({ by: 'name', dir: 1 });
  const visible = computed(() => {
    const text = filter().trim().toLowerCase();
    const { by, dir } = sort();
    const rows = (members.data() ?? []).filter((m) => !text || m.name.toLowerCase().includes(text) || m.email.includes(text) || m.team.toLowerCase().includes(text));
    return rows.sort((a, b) => (by === 'active' ? a.active - b.active : a[by].localeCompare(b[by])) * dir || (a.id < b.id ? -1 : 1));
  });
  const sortBy = (by) => setSort((s) => ({ by, dir: s.by === by ? -s.dir : 1 }));
  return (
    <main class="page" data-page="members">
      <div class="page-head">
        <h1>Members</h1>
        <input type="search" placeholder="Filter by name, email or team" data-member-filter
          value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
      </div>
      <p class="muted" data-member-count>
        {members.data() ? `Showing ${visible().length} of ${members.data().length}` : 'Loading members…'}
      </p>
      <table class="table" data-members>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.id}>
                <button class="sort" data-sort={c.id} onClick={() => sortBy(c.id)}
                  aria-sort={sort().by === c.id ? (sort().dir === 1 ? 'ascending' : 'descending') : 'none'}>
                  {c.label}{sort().by === c.id ? (sort().dir === 1 ? ' ↑' : ' ↓') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible().map((m) => (
            <tr key={m.id} data-member={m.id}>
              <td>{m.name}</td>
              <td>{m.email}</td>
              <td>{m.role}</td>
              <td>{m.team}</td>
              <td>{day(m.active)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
