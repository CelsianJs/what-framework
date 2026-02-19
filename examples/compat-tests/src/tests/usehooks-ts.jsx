import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocalStorage, useDebounceValue, useMediaQuery } from 'usehooks-ts';

function TestComponent() {
  const [name, setName] = useLocalStorage('compat-test-name', 'World');
  const [debouncedName] = useDebounceValue(name, 300);
  const isDark = useMediaQuery('(prefers-color-scheme: dark)');

  return (
    <div>
      <div style={{ marginBottom: '6px' }}>
        <input
          type="text"
          value={name}
          oninput={(e) => setName(e.target.value)}
          placeholder="Type a name..."
          style={{ padding: '4px 8px', background: '#222', color: '#fff', border: '1px solid #444', borderRadius: '4px', width: '100%' }}
        />
      </div>
      <div style={{ fontSize: '11px', color: '#888' }}>
        <div>Stored: <span style={{ color: '#4ade80' }}>{name}</span></div>
        <div>Debounced: <span style={{ color: '#60a5fa' }}>{debouncedName}</span></div>
        <div>Dark mode: <span style={{ color: isDark ? '#facc15' : '#a78bfa' }}>{isDark ? 'Yes' : 'No'}</span></div>
      </div>
    </div>
  );
}

TestComponent.packageName = 'usehooks-ts';
TestComponent.downloads = '2.6M/week';
export default TestComponent;
