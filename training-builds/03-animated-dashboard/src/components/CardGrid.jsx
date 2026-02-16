import { useMediaQuery } from 'what-framework';

/**
 * CardGrid
 * Responsive grid container for dashboard cards.
 * Uses useMediaQuery for breakpoint-aware column counts:
 *   - Desktop (>= 900px): 3 columns
 *   - Tablet (>= 600px): 2 columns
 *   - Mobile (< 600px): 1 column
 */
export function CardGrid({ children }) {
  const isDesktop = useMediaQuery('(min-width: 900px)');
  const isTablet = useMediaQuery('(min-width: 600px)');

  function getColumns() {
    if (isDesktop()) return '3';
    if (isTablet()) return '2';
    return '1';
  }

  return (
    <div style={() => ({
      display: 'grid',
      gridTemplateColumns: `repeat(${getColumns()}, 1fr)`,
      gap: '1.25rem',
    })}>
      {children}
    </div>
  );
}
