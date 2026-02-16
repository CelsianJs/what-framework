import { useForm, rules, simpleResolver } from 'what-framework';
import { useExpenseStore, CATEGORIES, CATEGORY_COLORS } from '../store/expenses';

const inputStyle = 'width: 100%; padding: 0.625rem 0.875rem; background: #1a1a1a; border: 1px solid #333; border-radius: 0.5rem; color: #e5e5e5; font-size: 0.875rem; outline: none; transition: border-color 0.2s;';

export function ExpenseForm() {
  const store = useExpenseStore();

  const { register, handleSubmit, formState, reset } = useForm({
    defaultValues: {
      description: '',
      amount: '',
      category: '',
    },
    resolver: simpleResolver({
      description: [rules.required('Description is required')],
      amount: [
        rules.required('Amount is required'),
        (value) => {
          const num = parseFloat(value);
          if (isNaN(num) || num < 0.01) return 'Amount must be at least $0.01';
        },
      ],
      category: [rules.required('Please select a category')],
    }),
  });

  const onSubmit = handleSubmit((values) => {
    store.addExpense({
      description: values.description.trim(),
      amount: parseFloat(values.amount),
      category: values.category,
    });
    reset();
  });

  return (
    <form onsubmit={onSubmit} style="margin-bottom: 2rem;">
      <h2 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; color: #f5f5f5;">
        Add Expense
      </h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 0.75rem; align-items: start;">
        <div>
          <input
            {...register('description')}
            placeholder="Description"
            style={inputStyle}
          />
          {() => {
            const errors = formState.errors;
            return errors.description ? (
              <span style="display: block; color: #ef4444; font-size: 0.75rem; margin-top: 0.25rem;">
                {errors.description.message}
              </span>
            ) : null;
          }}
        </div>

        <div>
          <input
            {...register('amount')}
            type="number"
            step="0.01"
            min="0.01"
            placeholder="Amount"
            style={inputStyle}
          />
          {() => {
            const errors = formState.errors;
            return errors.amount ? (
              <span style="display: block; color: #ef4444; font-size: 0.75rem; margin-top: 0.25rem;">
                {errors.amount.message}
              </span>
            ) : null;
          }}
        </div>

        <div>
          <select
            {...register('category')}
            style={inputStyle + ' cursor: pointer;'}
          >
            <option value="" disabled>Select category</option>
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat} style={`color: ${CATEGORY_COLORS[cat]}`}>
                {cat}
              </option>
            ))}
          </select>
          {() => {
            const errors = formState.errors;
            return errors.category ? (
              <span style="display: block; color: #ef4444; font-size: 0.75rem; margin-top: 0.25rem;">
                {errors.category.message}
              </span>
            ) : null;
          }}
        </div>

        <button
          type="submit"
          style="padding: 0.625rem 1.5rem; background: #3b82f6; color: white; border: none; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: background 0.2s; white-space: nowrap;"
          onmouseenter={(e) => { e.target.style.background = '#2563eb'; }}
          onmouseleave={(e) => { e.target.style.background = '#3b82f6'; }}
        >
          Add Expense
        </button>
      </div>
    </form>
  );
}
