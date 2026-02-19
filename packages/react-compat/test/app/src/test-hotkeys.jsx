import React, { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

export function HotkeysTest() {
  const [log, setLog] = useState([]);
  const addLog = (msg) => setLog(prev => [msg, ...prev].slice(0, 5));

  useHotkeys('ctrl+k, meta+k', (e) => { e.preventDefault(); addLog('⌘K / Ctrl+K pressed'); });
  useHotkeys('ctrl+s, meta+s', (e) => { e.preventDefault(); addLog('⌘S / Ctrl+S pressed'); });
  useHotkeys('escape', () => addLog('Escape pressed'));
  useHotkeys('shift+?', () => addLog('Shift+? pressed'));

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-hotkeys-hook</h3>
      <p style={{ margin: '4px 0 8px', color: '#666', fontSize: 13 }}>
        Try: ⌘K, ⌘S, Esc, Shift+?
      </p>
      <div style={{ background: '#f5f5f5', borderRadius: 4, padding: 8, minHeight: 60, fontFamily: 'monospace', fontSize: 12 }}>
        {log.length === 0 ? (
          <span style={{ color: '#999' }}>Press a hotkey...</span>
        ) : (
          log.map((entry, i) => <div key={i} style={{ opacity: 1 - i * 0.15 }}>{entry}</div>)
        )}
      </div>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — useHotkeys hook registered</p>
    </div>
  );
}
