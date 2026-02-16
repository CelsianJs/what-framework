import { useRef, useSignal, useEffect, onMount, tween, easings } from 'what-framework';
import { AnimatedNumber } from './AnimatedNumber.jsx';

/**
 * MetricCard
 * Displays a single dashboard metric with animated value transitions.
 * Shows a trend indicator (up/down arrow) and the delta from previous value.
 * Entrance animation: fade in + slide up on mount.
 *
 * Props:
 *   metric - { id, label, prefix, suffix, format }
 *   value  - current numeric value
 *   index  - position in the grid (used for staggered entrance)
 */
export function MetricCard({ metric, value, index }) {
  const cardRef = useRef(null);
  const prevValue = useRef(value);
  const delta = useSignal(0);
  const hasAnimatedEntrance = useRef(false);

  // Track value changes and compute delta
  useEffect(() => {
    const diff = value - prevValue.current;
    delta(diff);
    prevValue.current = value;
  }, [value]);

  // Entrance animation: staggered fade + slide up
  onMount(() => {
    if (cardRef.current && !hasAnimatedEntrance.current) {
      hasAnimatedEntrance.current = true;
      const el = cardRef.current;
      // Start invisible and offset
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';

      // Staggered delay based on card index
      const delay = index * 80;
      setTimeout(() => {
        tween(0, 1, {
          duration: 500,
          easing: easings.easeOutCubic,
          onUpdate: (v) => {
            el.style.opacity = String(v);
            el.style.transform = `translateY(${24 * (1 - v)}px)`;
          },
        });
      }, delay);
    }
  });

  function getTrendIcon() {
    const d = delta();
    if (d > 0) return '\u2191'; // up arrow
    if (d < 0) return '\u2193'; // down arrow
    return '\u2022';            // bullet (no change)
  }

  function getTrendColor() {
    const d = delta();
    if (d > 0) return '#4ade80'; // green
    if (d < 0) return '#f87171'; // red
    return '#a1a1aa';            // gray
  }

  function formatDelta() {
    const d = delta();
    if (d === 0) return 'No change';
    const sign = d > 0 ? '+' : '';
    switch (metric.format) {
      case 'currency':
        return sign + d.toLocaleString('en-US', { minimumFractionDigits: d % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 });
      case 'number':
        return sign + Math.round(d).toLocaleString('en-US');
      case 'percent':
        return sign + d.toFixed(1);
      case 'rating':
        return sign + d.toFixed(1);
      default:
        return sign + d.toFixed(0);
    }
  }

  return (
    <div
      ref={cardRef}
      style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '16px',
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
        cursor: 'default',
        willChange: 'opacity, transform',
      }}
      onmouseenter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.4)';
        e.currentTarget.style.boxShadow = '0 8px 32px rgba(99, 102, 241, 0.15)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onmouseleave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Label */}
      <span style={{
        fontSize: '0.8rem',
        fontWeight: '500',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: '#a1a1aa',
      }}>
        {metric.label}
      </span>

      {/* Animated value */}
      <AnimatedNumber
        value={value}
        format={metric.format}
        prefix={metric.prefix || ''}
        suffix={metric.suffix || ''}
      />

      {/* Trend indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {() => {
          const color = getTrendColor();
          return (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: color === '#4ade80' ? 'rgba(74, 222, 128, 0.15)'
                         : color === '#f87171' ? 'rgba(248, 113, 113, 0.15)'
                         : 'rgba(161, 161, 170, 0.15)',
              color: color,
              fontSize: '0.85rem',
              fontWeight: '700',
              transition: 'background 0.3s, color 0.3s',
            }}>
              {getTrendIcon()}
            </span>
          );
        }}
        {() => {
          const color = getTrendColor();
          return (
            <span style={{ color, fontSize: '0.8rem', transition: 'color 0.3s' }}>
              {formatDelta()}
            </span>
          );
        }}
      </div>
    </div>
  );
}
