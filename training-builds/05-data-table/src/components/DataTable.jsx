import { useSignal, useSWR, SkeletonTable } from 'what-framework';
import { fetchUsers } from '../data/mock-fetcher';
import { SearchBar } from './SearchBar';
import { SortHeader } from './SortHeader';
import { Pagination } from './Pagination';
import { TableRow } from './TableRow';

export function DataTable() {
  const page = useSignal(1);
  const search = useSignal('');
  const sortField = useSignal('id');
  const sortDir = useSignal('asc');

  // Build SWR key from current state — reading signals here means
  // the component re-renders when any of them change, giving useSWR
  // the new key on each render cycle.
  const swrKey = `users?page=${page()}&q=${encodeURIComponent(search())}&sort=${sortField()}&dir=${sortDir()}`;

  const result = useSWR(
    swrKey,
    fetchUsers,
    { revalidateOnFocus: false, dedupingInterval: 500 }
  );

  const handleSearch = (q) => {
    search(q);
    page(1); // reset to first page on new search
  };

  const handleSort = (field, dir) => {
    sortField(field);
    sortDir(dir);
    page(1);
  };

  const handlePageChange = (p) => {
    page(p);
  };

  const columns = [
    { field: 'id', label: 'ID' },
    { field: 'name', label: 'Name' },
    { field: 'role', label: 'Role' },
    { field: 'status', label: 'Status' },
    { field: 'joinDate', label: 'Joined' },
    { field: 'lastActive', label: 'Last Active' },
  ];

  return (
    <div>
      <SearchBar
        searchQuery={search}
        onSearch={handleSearch}
        totalResults={() => {
          const d = result.data();
          return d ? d.total : null;
        }}
      />

      {() => {
        const isLoading = result.isLoading();
        const error = result.error();
        const data = result.data();

        if (isLoading && !data) {
          return (
            <div style="background: #111; border: 1px solid #1e1e1e; border-radius: 0.75rem; padding: 1.5rem; overflow: hidden;">
              <SkeletonTable rows={10} columns={6} variant="pulse" />
            </div>
          );
        }

        if (error && !data) {
          return (
            <div style="background: #1a0a0a; border: 1px solid #7f1d1d; border-radius: 0.75rem; padding: 2rem; text-align: center;">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" style="margin: 0 auto 1rem;">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <p style="color: #fca5a5; font-size: 0.9375rem; margin-bottom: 1rem;">
                Failed to load users: {error.message}
              </p>
              <button
                onclick={() => result.revalidate()}
                style="padding: 0.5rem 1.25rem; background: #dc2626; color: white; border: none; border-radius: 0.5rem; font-size: 0.8125rem; cursor: pointer; transition: background 0.2s;"
                onmouseenter={(e) => { e.target.style.background = '#b91c1c'; }}
                onmouseleave={(e) => { e.target.style.background = '#dc2626'; }}
              >
                Retry
              </button>
            </div>
          );
        }

        if (data && data.users.length === 0) {
          return (
            <div style="background: #111; border: 1px solid #1e1e1e; border-radius: 0.75rem; padding: 3rem; text-align: center;">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#444" stroke-width="1.5" style="margin: 0 auto 1rem;">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
                <path d="M8 11h6" />
              </svg>
              <p style="color: #666; font-size: 0.9375rem;">No users found matching your search.</p>
            </div>
          );
        }

        return (
          <div style="background: #111; border: 1px solid #1e1e1e; border-radius: 0.75rem; overflow: hidden;">
            {() => result.isValidating() ? (
              <div style="height: 2px; background: linear-gradient(90deg, transparent 0%, #3b82f6 50%, transparent 100%); animation: shimmer 1.2s infinite; background-size: 200% 100%;" />
            ) : (
              <div style="height: 2px;" />
            )}
            <div style="overflow-x: auto;">
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background: #0d0d0d;">
                    {columns.map(col => (
                      <SortHeader
                        key={col.field}
                        label={col.label}
                        field={col.field}
                        currentSort={sortField}
                        currentDir={sortDir}
                        onSort={handleSort}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.users.map(user => (
                    <TableRow key={user.id} user={user} />
                  ))}
                </tbody>
              </table>
            </div>

            <div style="padding: 0 1rem 1rem;">
              <Pagination
                currentPage={() => {
                  const d = result.data();
                  return d ? d.page : 1;
                }}
                totalPages={() => {
                  const d = result.data();
                  return d ? d.totalPages : 1;
                }}
                onPageChange={handlePageChange}
              />
            </div>
          </div>
        );
      }}

      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
