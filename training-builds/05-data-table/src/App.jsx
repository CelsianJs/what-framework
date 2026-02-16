import { useSignal, useQuery, ErrorBoundary, Spinner } from 'what-framework';
import { fetchStats } from './data/mock-fetcher';
import { DataTable } from './components/DataTable';
import { InfiniteScroll } from './components/InfiniteScroll';

function StatsBar() {
  const { data, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  return (
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; margin-bottom: 2rem;">
      {() => {
        if (isLoading()) {
          return ['Total', 'Active', 'Inactive', 'Pending'].map(label => (
            <div key={label} style="background: #111; border: 1px solid #1e1e1e; border-radius: 0.75rem; padding: 1rem 1.25rem;">
              <div style="font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 0.5rem;">{label}</div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <Spinner size={16} color="#444" />
              </div>
            </div>
          ));
        }

        const stats = data();
        if (!stats) return null;

        const items = [
          { label: 'Total Users', value: stats.totalUsers, color: '#3b82f6' },
          { label: 'Active', value: stats.activeUsers, color: '#22c55e' },
          { label: 'Inactive', value: stats.inactiveUsers, color: '#ef4444' },
          { label: 'Pending', value: stats.pendingUsers, color: '#eab308' },
        ];

        return items.map(item => (
          <div
            key={item.label}
            style={`background: #111; border: 1px solid #1e1e1e; border-radius: 0.75rem; padding: 1rem 1.25rem; transition: border-color 0.2s;`}
            onmouseenter={(e) => { e.currentTarget.style.borderColor = item.color + '44'; }}
            onmouseleave={(e) => { e.currentTarget.style.borderColor = '#1e1e1e'; }}
          >
            <div style="font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 0.375rem;">
              {item.label}
            </div>
            <div style={`font-size: 1.5rem; font-weight: 700; color: ${item.color}; font-variant-numeric: tabular-nums;`}>
              {item.value}
            </div>
          </div>
        ));
      }}
    </div>
  );
}

function ViewToggle({ mode, onToggle }) {
  const btnBase = 'padding: 0.5rem 1rem; font-size: 0.8125rem; font-weight: 500; border: 1px solid #2a2a2a; transition: all 0.2s; outline: none; cursor: pointer;';

  return (
    <div style="display: flex; border-radius: 0.5rem; overflow: hidden; border: 1px solid #2a2a2a;">
      <button
        onclick={() => onToggle('paginated')}
        style={`${btnBase} border-right: none; border-radius: 0.5rem 0 0 0.5rem; ${mode() === 'paginated' ? 'background: #3b82f6; color: white; border-color: #3b82f6;' : 'background: #141414; color: #999;'}`}
      >
        Paginated
      </button>
      <button
        onclick={() => onToggle('infinite')}
        style={`${btnBase} border-radius: 0 0.5rem 0.5rem 0; ${mode() === 'infinite' ? 'background: #3b82f6; color: white; border-color: #3b82f6;' : 'background: #141414; color: #999;'}`}
      >
        Infinite Scroll
      </button>
    </div>
  );
}

export function App() {
  const viewMode = useSignal('paginated');

  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <div style="padding: 3rem; text-align: center;">
          <div style="background: #1a0a0a; border: 1px solid #7f1d1d; border-radius: 0.75rem; padding: 2rem; display: inline-block;">
            <h2 style="color: #fca5a5; font-size: 1.25rem; margin-bottom: 0.75rem;">Something went wrong</h2>
            <p style="color: #ef4444; font-size: 0.875rem; margin-bottom: 1rem;">{error.message}</p>
            <button
              onclick={reset}
              style="padding: 0.5rem 1.25rem; background: #dc2626; color: white; border: none; border-radius: 0.5rem; font-size: 0.8125rem; cursor: pointer;"
            >
              Try Again
            </button>
          </div>
        </div>
      )}
    >
      <div>
        {/* Header */}
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem;">
          <div>
            <h1 style="font-size: 1.5rem; font-weight: 700; color: #f5f5f5; margin-bottom: 0.25rem;">User Directory</h1>
            <p style="font-size: 0.8125rem; color: #666;">Manage and browse all registered users</p>
          </div>
          <ViewToggle mode={viewMode} onToggle={(m) => viewMode(m)} />
        </div>

        {/* Stats */}
        <StatsBar />

        {/* Content based on view mode */}
        {() => {
          const mode = viewMode();
          if (mode === 'paginated') {
            return <DataTable />;
          }
          return <InfiniteScroll />;
        }}
      </div>
    </ErrorBoundary>
  );
}
