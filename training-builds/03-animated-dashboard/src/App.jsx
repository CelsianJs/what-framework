import { Dashboard } from './components/Dashboard.jsx';

/**
 * App
 * Root component for the Animated Dashboard training app.
 * Renders the Dashboard layout with a subtle background pattern.
 */
export function App() {
  return (
    <div style={{
      minHeight: '100vh',
      padding: '0',
    }}>
      {/* Decorative gradient accent at top */}
      <div style={{
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        height: '3px',
        background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa, #8b5cf6, #6366f1)',
        zIndex: '100',
      }} />

      <Dashboard />
    </div>
  );
}
