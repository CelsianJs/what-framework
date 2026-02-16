import { ExpenseForm } from './components/ExpenseForm';
import { CategoryFilter } from './components/CategoryFilter';
import { ExpenseList } from './components/ExpenseList';
import { Summary } from './components/Summary';

export function App() {
  return (
    <div>
      <header style="margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid #222;">
        <h1 style="font-size: 1.75rem; font-weight: 700; color: #f5f5f5; letter-spacing: -0.025em;">
          Expense Tracker
        </h1>
        <p style="color: #666; font-size: 0.875rem; margin-top: 0.25rem;">
          Track your spending across categories
        </p>
      </header>

      <ExpenseForm />
      <Summary />
      <CategoryFilter />
      <ExpenseList />
    </div>
  );
}
