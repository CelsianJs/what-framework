import { useSignal, batch } from 'what-framework';
import { METRICS, generateMetrics } from '../data/mock-metrics.js';
import { MetricCard } from './MetricCard.jsx';
import { CardGrid } from './CardGrid.jsx';

/**
 * Dashboard
 * Main dashboard component that manages metric data state,
 * renders a responsive grid of MetricCards, and provides
 * a refresh button to generate new random values.
 */
export function Dashboard() {
  const metrics = useSignal(generateMetrics());
  const refreshCount = useSignal(0);

  function handleRefresh() {
    batch(() => {
      metrics(generateMetrics());
      refreshCount(prev => prev + 1);
    });
  }

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '2rem',
        flexWrap: 'wrap',
        gap: '1rem',
      }}>
        <div>
          <h1 style={{
            fontSize: '1.75rem',
            fontWeight: '700',
            color: '#f0f0f0',
            margin: '0 0 0.25rem 0',
          }}>
            Dashboard Metrics
          </h1>
          <p style={{
            fontSize: '0.875rem',
            color: '#71717a',
            margin: '0',
          }}>
            {() => {
              const count = refreshCount();
              return count === 0
                ? 'Real-time overview of key performance indicators'
                : `Refreshed ${count} time${count === 1 ? '' : 's'}`;
            }}
          </p>
        </div>

        <button
          onclick={handleRefresh}
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            color: '#fff',
            border: 'none',
            borderRadius: '10px',
            padding: '0.65rem 1.5rem',
            fontSize: '0.875rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'transform 0.15s, box-shadow 0.15s',
            boxShadow: '0 2px 12px rgba(99, 102, 241, 0.3)',
          }}
          onmouseenter={(e) => {
            e.currentTarget.style.transform = 'scale(1.03)';
            e.currentTarget.style.boxShadow = '0 4px 20px rgba(99, 102, 241, 0.45)';
          }}
          onmouseleave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 2px 12px rgba(99, 102, 241, 0.3)';
          }}
          onmousedown={(e) => {
            e.currentTarget.style.transform = 'scale(0.97)';
          }}
          onmouseup={(e) => {
            e.currentTarget.style.transform = 'scale(1.03)';
          }}
        >
          Refresh Data
        </button>
      </div>

      {/* Metrics Grid */}
      <CardGrid>
        {() => {
          const currentMetrics = metrics();
          return METRICS.map((metric, index) => (
            <MetricCard
              key={metric.id}
              metric={metric}
              value={currentMetrics[metric.id]}
              index={index}
            />
          ));
        }}
      </CardGrid>
    </div>
  );
}
