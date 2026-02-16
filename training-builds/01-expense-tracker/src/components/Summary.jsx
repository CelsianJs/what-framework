import { useExpenseStore, CATEGORIES, CATEGORY_COLORS } from '../store/expenses';

export function Summary() {
  const store = useExpenseStore();

  return (
    <div style="margin-bottom: 2rem;">
      <h2 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; color: #f5f5f5;">
        Summary
      </h2>

      <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 1rem;">
        {/* Total Card */}
        <div style="background: #141414; border: 1px solid #222; border-radius: 0.75rem; padding: 1.5rem; display: flex; flex-direction: column; justify-content: center; align-items: center;">
          <span style="font-size: 0.8125rem; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">
            Total Spent
          </span>
          <span style="font-size: 2rem; font-weight: 700; color: #f5f5f5;">
            {() => `$${store.total.toFixed(2)}`}
          </span>
          <span style="font-size: 0.8125rem; color: #555; margin-top: 0.25rem;">
            {() => {
              const count = store.expenses.length;
              return `${count} expense${count !== 1 ? 's' : ''}`;
            }}
          </span>
        </div>

        {/* Category Breakdown */}
        <div style="background: #141414; border: 1px solid #222; border-radius: 0.75rem; padding: 1.25rem;">
          <span style="font-size: 0.8125rem; color: #666; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.75rem;">
            By Category
          </span>
          {() => {
            const byCategory = store.byCategory;
            const total = store.total;
            const entries = CATEGORIES.filter(cat => byCategory[cat] > 0).map(cat => ({
              name: cat,
              amount: byCategory[cat],
              color: CATEGORY_COLORS[cat],
              percent: total > 0 ? (byCategory[cat] / total * 100) : 0,
            }));

            if (entries.length === 0) {
              return (
                <div style="color: #555; font-size: 0.875rem; text-align: center; padding: 1rem 0;">
                  No data yet
                </div>
              );
            }

            return (
              <div style="display: flex; flex-direction: column; gap: 0.625rem;">
                {entries.map(entry => (
                  <div key={entry.name}>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                      <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span
                          style={`width: 0.5rem; height: 0.5rem; border-radius: 9999px; background: ${entry.color};`}
                        />
                        <span style="font-size: 0.8125rem; color: #ccc;">{entry.name}</span>
                      </div>
                      <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <span style="font-size: 0.75rem; color: #666;">
                          {entry.percent.toFixed(1)}%
                        </span>
                        <span style="font-size: 0.875rem; font-weight: 600; color: #e5e5e5; min-width: 4rem; text-align: right;">
                          ${entry.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div style="height: 0.25rem; background: #222; border-radius: 9999px; overflow: hidden;">
                      <div
                        style={`height: 100%; width: ${entry.percent}%; background: ${entry.color}; border-radius: 9999px; transition: width 0.3s ease;`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            );
          }}
        </div>
      </div>
    </div>
  );
}
