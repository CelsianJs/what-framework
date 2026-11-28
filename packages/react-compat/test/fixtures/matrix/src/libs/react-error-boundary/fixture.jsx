import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ErrorBoundary, useErrorBoundary } from 'react-error-boundary';

// What the effects of the boundary's children did, in order.
const life = [];
globalThis.__ebLife = life;

function Tracker() {
  useLayoutEffect(() => { life.push('layout+'); return () => { life.push('layout-'); }; }, []);
  useEffect(() => { life.push('effect+'); return () => { life.push('effect-'); }; }, []);
  return null;
}

function Bomb({ armed }) {
  if (armed) throw new Error('boom in render');
  return <p id="eb-ok">all good</p>;
}

function EffectBomb({ armed }) {
  useEffect(() => { if (armed) throw new Error('boom in effect'); }, [armed]);
  return <span id="eb-effect">effect ok</span>;
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

// The fallback moves focus to its button when it mounts: a ref, read in an effect.
function Fallback({ error, resetErrorBoundary }) {
  const retry = useRef(null);
  useEffect(() => { retry.current.focus(); }, []);
  return (
    <div role="alert">
      <span id="eb-message">{error.message}</span>
      <button id="eb-retry" ref={retry} onClick={resetErrorBoundary}>try again</button>
    </div>
  );
}

export default function Fixture() {
  const [armed, setArmed] = useState(false);
  const [effectArmed, setEffectArmed] = useState(false);
  const [key, setKey] = useState(0);
  const [boundary, setBoundary] = useState(0);
  const [errors, setErrors] = useState([]);
  const [resets, setResets] = useState(0);
  const [reason, setReason] = useState('');
  return (
    <div>
      <button id="eb-arm" onClick={() => setArmed(true)}>arm</button>
      <button id="eb-arm-effect" onClick={() => setEffectArmed(true)}>arm the effect</button>
      <button id="eb-key" onClick={() => { setArmed(false); setKey(key + 1); }}>new key</button>
      <button id="eb-remount" onClick={() => setBoundary(boundary + 1)}>remount</button>
      <ErrorBoundary
        key={boundary}
        FallbackComponent={Fallback}
        resetKeys={[key]}
        onError={(error) => setErrors((list) => [...list, error.message])}
        onReset={(details) => {
          setArmed(false);
          setEffectArmed(false);
          setResets((n) => n + 1);
          // resetErrorBoundary was the button's onClick: its argument is the click event.
          const event = details.reason === 'imperative-api' ? details.args[0] : null;
          setReason(event ? `${details.reason}:${event.type}:${typeof event.isPropagationStopped}` : details.reason);
        }}
      >
        <Tracker />
        <Bomb armed={armed} />
        <EffectBomb armed={effectArmed} />
        <Late />
      </ErrorBoundary>
      <span id="eb-errors">{errors.join('|')}</span>
      <span id="eb-resets">{resets}</span>
      <span id="eb-reason">{reason}</span>
      <p id="eb-outside">outside stays</p>
    </div>
  );
}
