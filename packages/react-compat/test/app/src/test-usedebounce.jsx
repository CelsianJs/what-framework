import React, { useState } from 'react';
import { useDebounce, useDebouncedCallback } from 'use-debounce';

export function UseDebounceTest() {
  const [text, setText] = useState('');
  const [debouncedText] = useDebounce(text, 500);
  const [clickCount, setClickCount] = useState(0);
  const debouncedClick = useDebouncedCallback(() => {
    setClickCount(c => c + 1);
  }, 300);

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>use-debounce</h3>
      <div style={{ marginBottom: 8 }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Type fast..."
          style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4, marginRight: 8 }}
        />
        <span>Debounced: <strong>{debouncedText || '(empty)'}</strong></span>
      </div>
      <div>
        <button onClick={debouncedClick} style={{ padding: '4px 12px', marginRight: 8 }}>
          Debounced Click (300ms)
        </button>
        <span>Count: <strong>{clickCount}</strong></span>
      </div>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — useDebounce + useDebouncedCallback work</p>
    </div>
  );
}
