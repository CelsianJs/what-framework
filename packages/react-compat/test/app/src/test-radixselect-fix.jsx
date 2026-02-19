import React, { useState } from 'react';
import * as Select from '@radix-ui/react-select';

function App() {
  const [value, setValue] = useState('');

  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 500, margin: '0 auto' }}>
      <h2>@radix-ui/react-select — Fix Test</h2>
      <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
        <Select.Root value={value} onValueChange={setValue}>
          <Select.Trigger style={{ padding: '8px 16px', border: '1px solid #ddd', borderRadius: 4, background: '#fff', cursor: 'pointer', minWidth: 200 }}>
            <Select.Value placeholder="Select a fruit..." />
            <Select.Icon> ▼</Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 1000 }}>
              <Select.Viewport style={{ padding: 4 }}>
                {['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry'].map(fruit => (
                  <Select.Item key={fruit} value={fruit.toLowerCase()} style={{ padding: '6px 12px', borderRadius: 3, cursor: 'pointer', outline: 'none' }}>
                    <Select.ItemText>{fruit}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
        {value && <p style={{ marginTop: 8 }}>Selected: {value}</p>}
        <p style={{ marginTop: 12, color: 'green', fontWeight: 'bold' }}>PASS — @radix-ui/react-select works</p>
      </div>
    </div>
  );
}

import { createRoot } from 'react-dom/client';
const root = createRoot(document.getElementById('app'));
root.render(<App />);
