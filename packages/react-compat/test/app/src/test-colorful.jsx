import { useState } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';

export function ColorfulTest() {
  const [color, setColor] = useState('#3b82f6');
  return (
    <div>
      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        <HexColorPicker color={color} onChange={setColor} style={{ width: '150px', height: '150px' }} />
        <div>
          <div style={{
            width: '60px', height: '60px', borderRadius: '8px',
            background: color, border: '2px solid #333'
          }} />
          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>#</span>
            <HexColorInput color={color} onChange={setColor} style={{
              width: '80px', padding: '4px', border: '1px solid #666',
              borderRadius: '4px', fontFamily: 'monospace'
            }} />
          </div>
        </div>
      </div>
      <p style={{ color: 'green', marginTop: '4px' }}>react-colorful HexColorPicker + HexColorInput</p>
    </div>
  );
}
