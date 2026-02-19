import { useState } from 'react';
import { useToggle, useWindowSize, useMouse } from 'react-use';

function TestComponent() {
  const [on, toggle] = useToggle(false);
  const { width, height } = useWindowSize();
  const mouseRef = { current: null };
  const mouse = useMouse(mouseRef);

  return (
    <div ref={mouseRef}>
      <div style={{ marginBottom: '6px' }}>
        <button
          onclick={toggle}
          style={{ padding: '4px 10px', cursor: 'pointer', background: on ? '#22c55e' : '#333', color: '#fff', border: '1px solid #555', borderRadius: '4px' }}
        >
          Toggle: {on ? 'ON' : 'OFF'}
        </button>
      </div>
      <div style={{ fontSize: '11px', color: '#888' }}>
        <div>Window: <span style={{ color: '#60a5fa' }}>{width}x{height}</span></div>
        <div>Mouse: <span style={{ color: '#facc15' }}>({mouse.docX}, {mouse.docY})</span></div>
      </div>
    </div>
  );
}

TestComponent.packageName = 'react-use';
TestComponent.downloads = '2.8M/week';
export default TestComponent;
