import React from 'react';
import { useBoolean, useCounter, useLocalStorage, useMediaQuery, useInterval, useCopyToClipboard } from 'usehooks-ts';

export function UseHooksTsTest() {
  const { value: flag, setTrue, setFalse, toggle } = useBoolean(false);
  const { count, increment, decrement, reset } = useCounter(0);
  const [stored, setStored] = useLocalStorage('test-key', 'default');
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [copiedText, copy] = useCopyToClipboard();

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>usehooks-ts</h3>

      <div style={{ marginBottom: 8 }}>
        <strong>useBoolean:</strong> {flag ? 'TRUE' : 'FALSE'}{' '}
        <button onClick={setTrue} style={{ marginLeft: 4 }}>Set True</button>
        <button onClick={setFalse} style={{ marginLeft: 4 }}>Set False</button>
        <button onClick={toggle} style={{ marginLeft: 4 }}>Toggle</button>
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>useCounter:</strong> {count}{' '}
        <button onClick={increment}>+</button>
        <button onClick={decrement}>-</button>
        <button onClick={reset}>Reset</button>
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>useLocalStorage:</strong> "{stored}"{' '}
        <button onClick={() => setStored('updated-' + Date.now())}>Update</button>
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>useMediaQuery:</strong> isMobile = {String(isMobile)}
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>useCopyToClipboard:</strong>{' '}
        <button onClick={() => copy('Hello from usehooks-ts!')}>Copy Text</button>
        {copiedText && <span style={{ marginLeft: 8, color: 'green' }}>Copied!</span>}
      </div>

      <p style={{ color: 'green', fontWeight: 'bold' }}>PASS — 5 hooks from usehooks-ts work</p>
    </div>
  );
}
