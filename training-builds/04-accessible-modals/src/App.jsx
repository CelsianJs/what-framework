import { SkipLink } from 'what-framework';
import { DemoPage } from './components/DemoPage.jsx';

/**
 * App
 * Root component for the Accessible Modal System training app.
 * Includes a SkipLink for screen reader / keyboard navigation.
 */
export function App() {
  return (
    <div style={{ minHeight: '100vh', padding: '0' }}>
      {/* Decorative gradient accent at top */}
      <div style={{
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        height: '3px',
        background: 'linear-gradient(90deg, #22c55e, #6366f1, #a78bfa, #6366f1, #22c55e)',
        zIndex: '100',
      }} />

      {/* Skip link for keyboard/screen reader users */}
      <SkipLink href="#main" />

      <DemoPage />
    </div>
  );
}
