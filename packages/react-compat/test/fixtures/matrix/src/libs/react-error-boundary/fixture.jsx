import { useState } from 'react';
import { ErrorBoundary, useErrorBoundary } from 'react-error-boundary';

function Bomb({ armed }) {
  if (armed) throw new Error('boom in render');
  return <p id="eb-ok">all good</p>;
}

function Late() {
  const { showBoundary } = useErrorBoundary();
  const [n, setN] = useState(0);
  return (
    <div>
      <button id="eb-count" onClick={() => setN(n + 1)}>count {n}</button>
      <button id="eb-async" onClick={() => setTimeout(() => showBoundary(new Error('boom later')), 20)}>fail later</button>
    </div>
  );
}

function Fallback({ error, resetErrorBoundary }) {
  return (
    <div role="alert">
      <span id="eb-message">{error.message}</span>
      <button id="eb-retry" onClick={resetErrorBoundary}>try again</button>
    </div>
  );
}

export default function Fixture() {
  const [armed, setArmed] = useState(false);
  const [key, setKey] = useState(0);
  const [errors, setErrors] = useState([]);
  const [resets, setResets] = useState(0);
  return (
    <div>
      <button id="eb-arm" onClick={() => setArmed(true)}>arm</button>
      <button id="eb-key" onClick={() => { setArmed(false); setKey(key + 1); }}>new key</button>
      <ErrorBoundary
        FallbackComponent={Fallback}
        resetKeys={[key]}
        onError={(error) => setErrors((list) => [...list, error.message])}
        onReset={() => { setArmed(false); setResets((n) => n + 1); }}
      >
        <Bomb armed={armed} />
        <Late />
      </ErrorBoundary>
      <span id="eb-errors">{errors.join('|')}</span>
      <span id="eb-resets">{resets}</span>
      <p id="eb-outside">outside stays</p>
    </div>
  );
}
