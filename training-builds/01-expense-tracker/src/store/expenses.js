import { createStore, derived, signal } from 'what-framework';

const CATEGORIES = ['Food', 'Transport', 'Entertainment', 'Bills', 'Shopping', 'Other'];

const CATEGORY_COLORS = {
  Food: '#22c55e',
  Transport: '#3b82f6',
  Entertainment: '#a855f7',
  Bills: '#ef4444',
  Shopping: '#f59e0b',
  Other: '#6b7280',
};

// Standalone signal for the active filter (shared across components)
const activeFilter = signal('All');

// Load persisted expenses from localStorage
function loadExpenses() {
  try {
    const raw = localStorage.getItem('expense-tracker-data');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveExpenses(expenses) {
  try {
    localStorage.setItem('expense-tracker-data', JSON.stringify(expenses));
  } catch (e) {
    console.warn('Failed to save expenses:', e);
  }
}

const useExpenseStore = createStore({
  expenses: loadExpenses(),

  total: derived(state => {
    return state.expenses.reduce((sum, e) => sum + e.amount, 0);
  }),

  byCategory: derived(state => {
    const grouped = {};
    for (const expense of state.expenses) {
      if (!grouped[expense.category]) {
        grouped[expense.category] = 0;
      }
      grouped[expense.category] += expense.amount;
    }
    return grouped;
  }),

  addExpense(expense) {
    const newExpense = {
      ...expense,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      date: expense.date || new Date().toISOString().split('T')[0],
    };
    this.expenses = [newExpense, ...this.expenses];
    saveExpenses(this.expenses);
  },

  removeExpense(id) {
    this.expenses = this.expenses.filter(e => e.id !== id);
    saveExpenses(this.expenses);
  },

  bulkDelete(ids) {
    const idSet = new Set(ids);
    this.expenses = this.expenses.filter(e => !idSet.has(e.id));
    saveExpenses(this.expenses);
  },
});

export { useExpenseStore, CATEGORIES, CATEGORY_COLORS, activeFilter };
