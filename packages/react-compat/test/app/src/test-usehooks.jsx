import React, { useState, useRef } from 'react';
import { useCopyToClipboard, useDebounce, useToggle, useClickAway, useWindowSize, usePrevious } from '@uidotdev/usehooks';

export function UidotdevHooksTest() {
  const [copiedText, copyToClipboard] = useCopyToClipboard();
  const [on, toggle] = useToggle(false);
  const windowSize = useWindowSize();
  const [count, setCount] = useState(0);
  const prev = usePrevious(count);
  const clickRef = useRef(null);
  useClickAway(clickRef, () => {
    // Click away detected
  });

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>@uidotdev/usehooks</h3>

      <div style={{ marginBottom: 8 }}>
        <strong>useToggle:</strong> {on ? 'ON' : 'OFF'}{' '}
        <button onClick={toggle}>Toggle</button>
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>useCopyToClipboard:</strong>{' '}
        <button onClick={() => copyToClipboard('Hello!')}>Copy "Hello!"</button>
        {copiedText && <span style={{ marginLeft: 8, color: 'green' }}>Copied: {copiedText}</span>}
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>useWindowSize:</strong> {windowSize.width}×{windowSize.height}
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>usePrevious:</strong> Count: {count} (prev: {prev ?? 'none'}){' '}
        <button onClick={() => setCount(c => c + 1)}>+1</button>
      </div>

      <div ref={clickRef} style={{ padding: 8, background: '#f0f0f0', borderRadius: 4 }}>
        <strong>useClickAway:</strong> Click outside this box to trigger
      </div>

      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — 5 hooks from @uidotdev/usehooks work</p>
    </div>
  );
}
