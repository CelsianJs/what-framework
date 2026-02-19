import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';

function TestComponent() {
  const [color, setColor] = useState('#6366f1');

  return (
    <div>
      <HexColorPicker color={color} onChange={setColor} />
      <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 20, height: 20, borderRadius: 4, background: color, border: '1px solid #555' }} />
        <span>{color}</span>
      </div>
    </div>
  );
}

TestComponent.packageName = 'react-colorful';
TestComponent.downloads = '3.6M/week';
export default TestComponent;
