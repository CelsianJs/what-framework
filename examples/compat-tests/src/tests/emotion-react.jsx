import { useState } from 'react';
import { css } from '@emotion/react';

function TestComponent() {
  const [active, setActive] = useState(false);

  const boxStyle = css({
    color: active ? '#22c55e' : '#e5e5e5',
    padding: '12px 16px',
    background: active ? '#22c55e20' : '#1a1a2e',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    border: '1px solid',
    borderColor: active ? '#22c55e' : '#333',
    userSelect: 'none',
  });

  return (
    <div>
      <div css={boxStyle} onclick={() => setActive(!active)}>
        {active ? 'Active! (click to toggle)' : 'Click me to toggle'}
      </div>
      <div style={{ marginTop: '6px', fontSize: '11px', color: '#888' }}>
        Uses css() object styles from @emotion/react
      </div>
    </div>
  );
}

TestComponent.packageName = '@emotion/react';
TestComponent.downloads = '13.4M/week';
export default TestComponent;
