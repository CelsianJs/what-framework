// Team — showcases: useSWR, search with signals, skeleton loaders, For, Show, effects, useRef
import { h, useState, useEffect, useRef, useMemo } from 'what-framework';
import { useSWR } from 'what-framework/data';
import { announce } from 'what-framework/a11y';
import { fetchPeople } from '../data.js';

// ─── Team Member Card ───
function MemberCard({ person }) {
  return h('div', { class: 'team-card' },
    h('div', {
      class: 'team-avatar',
      style: `background: ${person.avatar}`,
    }, person.initials),
    h('div', { class: 'team-info' },
      h('div', { class: 'team-name' }, person.name),
      h('div', { class: 'team-role' }, person.role),
      h('div', { class: 'team-status' },
        h('span', { class: `team-status-dot ${person.status}` }),
        h('span', { class: 'text-muted text-xs' },
          person.status === 'online' ? 'Online' :
          person.status === 'away' ? 'Away' : 'Offline'
        ),
      ),
    ),
  );
}

// ─── Skeleton Card ───
function MemberSkeleton() {
  return h('div', { class: 'team-card' },
    h('div', { class: 'skeleton', style: 'width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;' }),
    h('div', { class: 'team-info', style: 'display: flex; flex-direction: column; gap: 6px;' },
      h('div', { class: 'skeleton', style: 'width: 120px; height: 14px;' }),
      h('div', { class: 'skeleton', style: 'width: 90px; height: 12px;' }),
      h('div', { class: 'skeleton', style: 'width: 50px; height: 12px;' }),
    ),
  );
}

// ─── Stats Bar ───
// `people` is an accessor; each count is a function child that follows it.
function TeamStats({ people }) {
  const list = () => people() || [];
  const total = () => list().length;
  const online = () => list().filter(p => p.status === 'online').length;
  const away = () => list().filter(p => p.status === 'away').length;
  const offline = () => list().filter(p => p.status === 'offline').length;

  return h('div', { class: 'flex gap-4 mb-4', style: 'flex-wrap: wrap;' },
    h('span', { class: 'text-sm' },
      h('span', { class: 'font-semibold' }, total),
      h('span', { class: 'text-muted' }, ' members'),
    ),
    h('span', { class: 'text-sm' },
      h('span', { style: 'color: var(--success)' }, '● '),
      h('span', { class: 'font-medium' }, online),
      h('span', { class: 'text-muted' }, ' online'),
    ),
    h('span', { class: 'text-sm' },
      h('span', { style: 'color: var(--warning)' }, '● '),
      h('span', { class: 'font-medium' }, away),
      h('span', { class: 'text-muted' }, ' away'),
    ),
    h('span', { class: 'text-sm' },
      h('span', { style: 'color: var(--text-muted)' }, '● '),
      h('span', { class: 'font-medium' }, offline),
      h('span', { class: 'text-muted' }, ' offline'),
    ),
  );
}

// ─── Team Page ───
export function Team() {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const inputRef = useRef(null);

  // SWR-cached people fetch. The key is a function of the query, so a new
  // query fetches its own entry and a query seen before is served from cache.
  const { data, isLoading, error, mutate } = useSWR(
    () => ['people', query()],
    () => fetchPeople(query()),
    { revalidateOnFocus: false },
  );

  // Filter by status client-side
  const filtered = useMemo(() => {
    const people = data() || [];
    if (statusFilter() === 'all') return people;
    return people.filter(p => p.status === statusFilter());
  });

  // Focus search on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const noResults = () => !isLoading() && !error() && filtered().length === 0;
  const hasResults = () => !isLoading() && !error() && filtered().length > 0;

  return h('div', null,
    // Search bar
    h('div', { class: 'search-bar' },
      h('span', { class: 'search-icon' }, '⌕'),
      h('input', {
        ref: inputRef,
        placeholder: 'Search team members...',
        value: query,
        onInput: (e) => setQuery(e.target.value),
        'aria-label': 'Search team members',
      }),
      h('span', { class: 'search-kbd' }, '⌘K'),
    ),

    // Filter + stats
    h('div', { class: 'flex items-center justify-between mb-4' },
      h('div', { class: 'flex gap-2' },
        ...['all', 'online', 'away', 'offline'].map(s =>
          h('button', {
            class: () => `btn btn-sm${statusFilter() === s ? ' btn-primary' : ''}`,
            onClick: () => { setStatusFilter(s); announce(`Filtering: ${s}`); },
          }, s.charAt(0).toUpperCase() + s.slice(1)),
        ),
      ),
      h(TeamStats, { people: data }),
    ),

    // Loading skeleton
    () => isLoading()
      ? h('div', { class: 'team-grid' },
          ...[1,2,3,4,5,6].map(() => h(MemberSkeleton)),
        )
      : null,

    // Error state
    () => error()
      ? h('div', { class: 'empty-state' },
          h('div', { class: 'empty-state-title' }, 'Failed to load team'),
          h('button', { class: 'btn btn-primary mt-4', onClick: () => mutate() }, 'Retry'),
        )
      : null,

    // Empty state
    () => noResults()
      ? h('div', { class: 'empty-state' },
          h('div', { class: 'empty-state-icon' }, '🔍'),
          h('div', { class: 'empty-state-title' }, 'No results'),
          h('div', { class: 'empty-state-desc' }, `No team members match "${query()}"`),
        )
      : null,

    // Results grid
    () => hasResults()
      ? h('div', { class: 'team-grid' },
          ...filtered().map(person =>
            h(MemberCard, { key: person.id, person }),
          ),
        )
      : null,
  );
}
