import { cls } from 'what-framework';
import { CATEGORIES, CATEGORY_COLORS, activeFilter } from '../store/expenses';

export function CategoryFilter() {
  const allFilters = ['All', ...CATEGORIES];

  return (
    <div style="margin-bottom: 1.5rem;">
      <h3 style="font-size: 0.875rem; font-weight: 500; color: #999; margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">
        Filter by Category
      </h3>
      <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
        {() => allFilters.map(filter => {
          const color = filter === 'All' ? '#3b82f6' : CATEGORY_COLORS[filter];
          return (
            <button
              key={filter}
              onClick={() => activeFilter.set(filter)}
              class={cls('filter-btn')}
              style={`
                padding: 0.375rem 0.875rem;
                border-radius: 9999px;
                font-size: 0.8125rem;
                font-weight: 500;
                border: 1px solid ${color}33;
                cursor: pointer;
                transition: all 0.2s;
                background: ${activeFilter() === filter ? color : 'transparent'};
                color: ${activeFilter() === filter ? '#fff' : color};
              `}
              onMouseEnter={(e) => {
                if (activeFilter() !== filter) {
                  e.target.style.background = color + '22';
                }
              }}
              onMouseLeave={(e) => {
                if (activeFilter() !== filter) {
                  e.target.style.background = 'transparent';
                }
              }}
            >
              {filter}
            </button>
          );
        })}
      </div>
    </div>
  );
}
