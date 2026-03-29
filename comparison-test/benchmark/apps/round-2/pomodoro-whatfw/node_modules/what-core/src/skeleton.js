// What Framework - Skeleton Loaders
// Loading placeholders for content, islands, and async data

import { h } from './h.js';
import { signal, effect } from './reactive.js';

// --- Skeleton Base Styles ---

const skeletonStyles = `
.what-skeleton {
  background: linear-gradient(
    90deg,
    var(--skeleton-base, #e0e0e0) 0%,
    var(--skeleton-highlight, #f0f0f0) 50%,
    var(--skeleton-base, #e0e0e0) 100%
  );
  background-size: 200% 100%;
  animation: what-skeleton-shimmer 1.5s infinite ease-in-out;
  border-radius: var(--skeleton-radius, 4px);
}

@keyframes what-skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.what-skeleton-pulse {
  animation: what-skeleton-pulse 1.5s infinite ease-in-out;
}

@keyframes what-skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.what-skeleton-wave {
  position: relative;
  overflow: hidden;
}

.what-skeleton-wave::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.4) 50%,
    transparent 100%
  );
  animation: what-skeleton-wave 1.5s infinite;
}

@keyframes what-skeleton-wave {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
`;

// Inject styles once
let stylesInjected = false;

function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.textContent = skeletonStyles;
  document.head.appendChild(style);
}

// --- Skeleton Component ---

export function Skeleton({
  width,
  height,
  variant = 'shimmer', // 'shimmer' | 'pulse' | 'wave'
  circle = false,
  class: className,
  style: customStyle,
  count = 1,
}) {
  injectStyles();

  const baseClass = `what-skeleton ${variant === 'pulse' ? 'what-skeleton-pulse' : ''} ${variant === 'wave' ? 'what-skeleton-wave' : ''}`;
  const finalClass = className ? `${baseClass} ${className}` : baseClass;

  const style = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius: circle ? '50%' : undefined,
    ...customStyle,
  };

  if (count === 1) {
    return h('div', { class: finalClass, style, 'aria-hidden': 'true' });
  }

  return Array.from({ length: count }, (_, i) =>
    h('div', {
      key: i,
      class: finalClass,
      style: { ...style, marginBottom: i < count - 1 ? '8px' : undefined },
      'aria-hidden': 'true',
    })
  );
}

// --- Skeleton Text ---

export function SkeletonText({
  lines = 3,
  lastLineWidth = '60%',
  lineHeight = 16,
  gap = 8,
  variant = 'shimmer',
}) {
  injectStyles();

  return h('div', { class: 'what-skeleton-text', 'aria-hidden': 'true' },
    Array.from({ length: lines }, (_, i) =>
      h('div', {
        key: i,
        class: `what-skeleton ${variant === 'pulse' ? 'what-skeleton-pulse' : ''}`,
        style: {
          height: `${lineHeight}px`,
          width: i === lines - 1 ? lastLineWidth : '100%',
          marginBottom: i < lines - 1 ? `${gap}px` : undefined,
        },
      })
    )
  );
}

// --- Skeleton Avatar ---

export function SkeletonAvatar({
  size = 40,
  variant = 'shimmer',
}) {
  return Skeleton({
    width: size,
    height: size,
    circle: true,
    variant,
  });
}

// --- Skeleton Card ---

export function SkeletonCard({
  imageHeight = 200,
  lines = 3,
  variant = 'shimmer',
}) {
  injectStyles();

  return h('div', { class: 'what-skeleton-card', 'aria-hidden': 'true' },
    // Image placeholder
    h('div', {
      class: `what-skeleton ${variant === 'pulse' ? 'what-skeleton-pulse' : ''}`,
      style: { height: `${imageHeight}px`, width: '100%', marginBottom: '16px' },
    }),
    // Title
    h('div', {
      class: `what-skeleton ${variant === 'pulse' ? 'what-skeleton-pulse' : ''}`,
      style: { height: '24px', width: '70%', marginBottom: '12px' },
    }),
    // Text lines
    SkeletonText({ lines, variant })
  );
}

// --- Skeleton Table ---

export function SkeletonTable({
  rows = 5,
  columns = 4,
  variant = 'shimmer',
}) {
  injectStyles();

  return h('div', { class: 'what-skeleton-table', 'aria-hidden': 'true' },
    // Header
    h('div', { style: { display: 'flex', gap: '16px', marginBottom: '16px' } },
      Array.from({ length: columns }, (_, i) =>
        h('div', {
          key: i,
          class: `what-skeleton ${variant === 'pulse' ? 'what-skeleton-pulse' : ''}`,
          style: { height: '20px', flex: 1 },
        })
      )
    ),
    // Rows
    Array.from({ length: rows }, (_, rowIndex) =>
      h('div', {
        key: rowIndex,
        style: {
          display: 'flex',
          gap: '16px',
          marginBottom: rowIndex < rows - 1 ? '12px' : undefined,
        },
      },
        Array.from({ length: columns }, (_, colIndex) =>
          h('div', {
            key: colIndex,
            class: `what-skeleton ${variant === 'pulse' ? 'what-skeleton-pulse' : ''}`,
            style: { height: '16px', flex: 1 },
          })
        )
      )
    )
  );
}

// --- Island Skeleton ---
// Specific skeleton for island placeholders

export function IslandSkeleton({
  type = 'default', // 'default' | 'card' | 'text' | 'custom'
  height,
  children,
}) {
  injectStyles();

  if (type === 'card') {
    return SkeletonCard({});
  }

  if (type === 'text') {
    return SkeletonText({});
  }

  if (children) {
    return children;
  }

  return h('div', {
    class: 'what-skeleton what-island-skeleton',
    style: {
      height: typeof height === 'number' ? `${height}px` : height || '100px',
      width: '100%',
    },
    'aria-hidden': 'true',
  });
}

// --- useSkeleton Hook ---
// Show skeleton while loading data

export function useSkeleton(asyncFn, deps = []) {
  const isLoading = signal(true);
  const data = signal(null);
  const error = signal(null);

  effect(() => {
    isLoading.set(true);
    error.set(null);

    Promise.resolve(asyncFn())
      .then(result => {
        data.set(result);
        isLoading.set(false);
      })
      .catch(err => {
        error.set(err);
        isLoading.set(false);
      });
  });

  return {
    isLoading: () => isLoading(),
    data: () => data(),
    error: () => error(),
    Skeleton: (props) => isLoading() ? Skeleton(props) : null,
  };
}

// --- Placeholder ---
// Generic placeholder with optional shimmer

export function Placeholder({
  width = '100%',
  height = 100,
  label = 'Loading...',
  showLabel = false,
  variant = 'shimmer',
}) {
  injectStyles();

  return h('div', {
    class: `what-skeleton ${variant === 'pulse' ? 'what-skeleton-pulse' : ''}`,
    style: {
      width: typeof width === 'number' ? `${width}px` : width,
      height: typeof height === 'number' ? `${height}px` : height,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    'aria-label': label,
    role: 'status',
  },
    showLabel && h('span', {
      style: {
        color: 'var(--skeleton-text, #999)',
        fontSize: '14px',
      },
    }, label)
  );
}

// --- Loading Dots ---

export function LoadingDots({ size = 8, color = '#666' }) {
  injectStyles();

  const dotStyle = {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    backgroundColor: color,
    animation: 'what-skeleton-pulse 1s infinite ease-in-out',
  };

  return h('div', {
    class: 'what-loading-dots',
    style: { display: 'flex', gap: `${size / 2}px` },
    'aria-label': 'Loading',
    role: 'status',
  },
    h('div', { style: { ...dotStyle, animationDelay: '0s' } }),
    h('div', { style: { ...dotStyle, animationDelay: '0.2s' } }),
    h('div', { style: { ...dotStyle, animationDelay: '0.4s' } })
  );
}

// --- Spinner ---

export function Spinner({ size = 24, color = '#666', strokeWidth = 2 }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    style: { animation: 'spin 1s linear infinite' },
    'aria-label': 'Loading',
    role: 'status',
  },
    h('style', null, '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'),
    h('circle', {
      cx: 12,
      cy: 12,
      r: 10,
      stroke: color,
      strokeWidth,
      fill: 'none',
      strokeDasharray: '31.4 31.4',
      strokeLinecap: 'round',
    })
  );
}
