import { useInfiniteQuery, useRef, onMount, onCleanup, LoadingDots, onIntersect } from 'what-framework';
import { fetchUsersInfinite } from '../data/mock-fetcher';
import { TableRow } from './TableRow';

export function InfiniteScroll() {
  const thStyle = 'padding: 0.75rem 1rem; text-align: left; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #999; border-bottom: 1px solid #1e1e1e;';
  const sentinelRef = useRef(null);

  const {
    data,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ['users', 'infinite'],
    queryFn: fetchUsersInfinite,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 0,
  });

  // Set up intersection observer on the sentinel element
  onMount(() => {
    const checkSentinel = () => {
      const el = sentinelRef.current;
      if (!el) {
        // Retry until sentinel is in the DOM
        const timer = setTimeout(checkSentinel, 100);
        return () => clearTimeout(timer);
      }

      const dispose = onIntersect(el, (entry) => {
        if (entry.isIntersecting && hasNextPage() && !isFetchingNextPage()) {
          fetchNextPage();
        }
      }, { rootMargin: '200px' });

      // Store dispose for cleanup
      sentinelRef._dispose = dispose;
    };
    checkSentinel();
  });

  onCleanup(() => {
    if (sentinelRef._dispose) sentinelRef._dispose();
  });

  const handleLoadMore = () => {
    if (hasNextPage() && !isFetchingNextPage()) {
      fetchNextPage();
    }
  };

  return (
    <div>
      <div style="background: #111; border: 1px solid #1e1e1e; border-radius: 0.75rem; overflow: hidden;">
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #0d0d0d;">
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Joined</th>
                <th style={thStyle}>Last Active</th>
              </tr>
            </thead>
            <tbody>
              {() => {
                const d = data();
                if (!d || !d.pages || d.pages.length === 0) {
                  return (
                    <tr>
                      <td colspan="6" style="padding: 3rem; text-align: center; color: #666;">
                        Loading users...
                      </td>
                    </tr>
                  );
                }
                return d.pages.flatMap(page =>
                  page.users.map(user => (
                    <TableRow key={user.id} user={user} />
                  ))
                );
              }}
            </tbody>
          </table>
        </div>

        {/* Loading indicator and load more */}
        <div style="padding: 1rem; text-align: center;">
          {() => {
            if (isFetchingNextPage()) {
              return (
                <div style="display: flex; align-items: center; justify-content: center; gap: 0.75rem; padding: 0.75rem;">
                  <LoadingDots size={6} color="#3b82f6" />
                  <span style="color: #666; font-size: 0.8125rem;">Loading more users...</span>
                </div>
              );
            }

            if (!hasNextPage()) {
              const d = data();
              const totalLoaded = d ? d.pages.reduce((acc, p) => acc + p.users.length, 0) : 0;
              return (
                <p style="color: #555; font-size: 0.8125rem; padding: 0.5rem;">
                  All {totalLoaded} users loaded
                </p>
              );
            }

            return (
              <button
                onclick={handleLoadMore}
                style="padding: 0.625rem 1.5rem; background: #1e1e1e; color: #e5e5e5; border: 1px solid #2a2a2a; border-radius: 0.5rem; font-size: 0.8125rem; cursor: pointer; transition: all 0.2s;"
                onmouseenter={(e) => { e.target.style.background = '#2a2a2a'; e.target.style.borderColor = '#3b82f6'; }}
                onmouseleave={(e) => { e.target.style.background = '#1e1e1e'; e.target.style.borderColor = '#2a2a2a'; }}
              >
                Load More
              </button>
            );
          }}
        </div>

        {/* Sentinel element for intersection observer */}
        <div ref={(el) => { sentinelRef.current = el; }} style="height: 1px;" />
      </div>

      {/* Count display */}
      <div style="margin-top: 0.75rem; text-align: center;">
        {() => {
          const d = data();
          if (!d || !d.pages) return null;
          const totalLoaded = d.pages.reduce((acc, p) => acc + p.users.length, 0);
          return (
            <span style="color: #666; font-size: 0.8125rem;">
              Showing {totalLoaded} of 100 users
            </span>
          );
        }}
      </div>
    </div>
  );
}
