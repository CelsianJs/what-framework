import { useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

function BuggyComponent() {
  const [shouldThrow, setShouldThrow] = useState(false);
  if (shouldThrow) throw new Error('Intentional test error!');
  return (
    <button onclick={() => setShouldThrow(true)} style={{ padding: '4px 10px' }}>
      Click to trigger error
    </button>
  );
}

function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div style={{ padding: '12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', color: '#991b1b' }}>
      <p style={{ fontWeight: 'bold' }}>Caught error:</p>
      <pre style={{ fontSize: '13px' }}>{error.message}</pre>
      <button onclick={resetErrorBoundary} style={{ marginTop: '8px', padding: '4px 10px' }}>Reset</button>
    </div>
  );
}

export function ErrorBoundaryTest() {
  return (
    <div>
      <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => {}}>
        <BuggyComponent />
      </ErrorBoundary>
      <p style={{ color: 'green', marginTop: '4px' }}>react-error-boundary with FallbackComponent + reset</p>
    </div>
  );
}
