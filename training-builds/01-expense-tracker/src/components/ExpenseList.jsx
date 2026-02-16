import { useSignal } from 'what-framework';
import { useExpenseStore, CATEGORY_COLORS, activeFilter } from '../store/expenses';

function ExpenseItem({ expense, selected, onToggle, onDelete }) {
  const color = CATEGORY_COLORS[expense.category] || '#6b7280';

  return (
    <div
      style={`
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 0.875rem 1rem;
        background: #141414;
        border: 1px solid ${selected ? '#3b82f6' : '#222'};
        border-radius: 0.5rem;
        transition: all 0.2s;
      `}
      onmouseenter={(e) => { if (!selected) e.currentTarget.style.borderColor = '#333'; }}
      onmouseleave={(e) => { if (!selected) e.currentTarget.style.borderColor = '#222'; }}
    >
      <input
        type="checkbox"
        checked={selected}
        oninput={onToggle}
        style="width: 1rem; height: 1rem; cursor: pointer; accent-color: #3b82f6;"
      />

      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: 500; color: #f5f5f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          {expense.description}
        </div>
        <div style="font-size: 0.75rem; color: #666; margin-top: 0.125rem;">
          {expense.date}
        </div>
      </div>

      <span
        style={`
          padding: 0.25rem 0.625rem;
          border-radius: 9999px;
          font-size: 0.6875rem;
          font-weight: 600;
          background: ${color}22;
          color: ${color};
          border: 1px solid ${color}33;
          white-space: nowrap;
        `}
      >
        {expense.category}
      </span>

      <span style="font-weight: 600; color: #e5e5e5; font-size: 1rem; min-width: 5rem; text-align: right;">
        ${expense.amount.toFixed(2)}
      </span>

      <button
        onclick={onDelete}
        style="padding: 0.375rem 0.625rem; background: transparent; border: 1px solid #333; border-radius: 0.375rem; color: #666; font-size: 0.75rem; cursor: pointer; transition: all 0.2s;"
        onmouseenter={(e) => { e.target.style.background = '#ef444422'; e.target.style.borderColor = '#ef4444'; e.target.style.color = '#ef4444'; }}
        onmouseleave={(e) => { e.target.style.background = 'transparent'; e.target.style.borderColor = '#333'; e.target.style.color = '#666'; }}
        title="Delete expense"
      >
        Delete
      </button>
    </div>
  );
}

export function ExpenseList() {
  const store = useExpenseStore();
  const selectedIds = useSignal(new Set());

  const filteredExpenses = () => {
    const filter = activeFilter();
    const expenses = store.expenses;
    if (filter === 'All') return expenses;
    return expenses.filter(e => e.category === filter);
  };

  const allSelected = () => {
    const filtered = filteredExpenses();
    if (filtered.length === 0) return false;
    const sel = selectedIds();
    return filtered.every(e => sel.has(e.id));
  };

  const selectedCount = () => {
    return selectedIds().size;
  };

  const toggleSelect = (id) => {
    const current = new Set(selectedIds());
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    selectedIds(current);
  };

  const toggleAll = () => {
    const filtered = filteredExpenses();
    if (allSelected()) {
      selectedIds(new Set());
    } else {
      selectedIds(new Set(filtered.map(e => e.id)));
    }
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds());
    if (ids.length === 0) return;
    store.bulkDelete(ids);
    selectedIds(new Set());
  };

  const handleDelete = (id) => {
    store.removeExpense(id);
    const current = new Set(selectedIds());
    current.delete(id);
    selectedIds(current);
  };

  return (
    <div>
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <h2 style="font-size: 1.25rem; font-weight: 600; color: #f5f5f5;">
            Expenses
          </h2>
          {() => {
            const count = filteredExpenses().length;
            return (
              <span style="font-size: 0.8125rem; color: #666;">
                ({count} {count === 1 ? 'item' : 'items'})
              </span>
            );
          }}
        </div>

        {() => {
          const count = selectedCount();
          return count > 0 ? (
            <button
              onclick={handleBulkDelete}
              style="padding: 0.5rem 1rem; background: #ef444422; border: 1px solid #ef4444; border-radius: 0.5rem; color: #ef4444; font-size: 0.8125rem; font-weight: 500; cursor: pointer; transition: all 0.2s;"
              onmouseenter={(e) => { e.target.style.background = '#ef444444'; }}
              onmouseleave={(e) => { e.target.style.background = '#ef444422'; }}
            >
              Delete Selected ({count})
            </button>
          ) : null;
        }}
      </div>

      {() => {
        const filtered = filteredExpenses();

        if (filtered.length === 0) {
          return (
            <div style="text-align: center; padding: 3rem 1rem; color: #555; border: 1px dashed #333; border-radius: 0.75rem;">
              <div style="font-size: 2rem; margin-bottom: 0.5rem;">
                {activeFilter() === 'All' ? '(empty)' : '(none)'}
              </div>
              <p style="font-size: 0.9375rem;">
                {activeFilter() === 'All'
                  ? 'No expenses yet. Add one above!'
                  : `No expenses in "${activeFilter()}" category.`}
              </p>
            </div>
          );
        }

        return (
          <div>
            <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 1rem; margin-bottom: 0.5rem;">
              <input
                type="checkbox"
                checked={allSelected()}
                oninput={toggleAll}
                style="width: 1rem; height: 1rem; cursor: pointer; accent-color: #3b82f6;"
              />
              <span style="font-size: 0.8125rem; color: #666;">Select all</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
              {filtered.map(expense => (
                <ExpenseItem
                  key={expense.id}
                  expense={expense}
                  selected={selectedIds().has(expense.id)}
                  onToggle={() => toggleSelect(expense.id)}
                  onDelete={() => handleDelete(expense.id)}
                />
              ))}
            </div>
          </div>
        );
      }}
    </div>
  );
}
