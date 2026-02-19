import './style.css';
import { createRoot } from 'react-dom/client';
import React, { useState, useEffect, Component } from 'react';

// Test registry — each test module registers itself here
window.__compatTests = window.__compatTests || [];

function TestCard({ name, downloads, children }) {
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  return (
    <div className={`test-card ${status}`}>
      <h3>{name}</h3>
      <div className="downloads">{downloads}</div>
      <div className="status">
        {status === 'loading' && '⏳ Loading...'}
        {status === 'pass' && '✅ PASS'}
        {status === 'fail' && `❌ FAIL: ${error}`}
      </div>
      <div className="demo">
        <ErrorBoundary name={name} onError={(e) => { setStatus('fail'); setError(e.message); }}>
          <PassDetector onPass={() => setStatus('pass')}>
            {children}
          </PassDetector>
        </ErrorBoundary>
      </div>
    </div>
  );
}

function PassDetector({ onPass, children }) {
  useEffect(() => {
    // If we rendered without throwing, it's a pass
    const t = setTimeout(() => onPass(), 500);
    return () => clearTimeout(t);
  }, []);
  return children;
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error) {
    this.props.onError?.(error);
  }
  render() {
    if (this.state.hasError) {
      return <div style={{ color: '#ef4444', fontSize: 12 }}>{this.state.error?.message}</div>;
    }
    return this.props.children;
  }
}

// Lazy-load test modules
const testModules = import.meta.glob('./tests/*.jsx', { eager: true });

function App() {
  const tests = Object.values(testModules).map(m => m.default).filter(Boolean);

  return (
    <div className="test-grid">
      {tests.map((Test, i) => (
        <TestCard key={i} name={Test.packageName} downloads={Test.downloads}>
          <Test />
        </TestCard>
      ))}
      {tests.length === 0 && <div style={{ color: '#666' }}>No test modules found. Add tests to src/tests/</div>}
    </div>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
