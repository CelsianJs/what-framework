import { useState } from 'react';
import { NumericFormat } from 'react-number-format';

function TestComponent() {
  const [value, setValue] = useState(1234567.89);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <NumericFormat
        value={value}
        thousandSeparator=","
        prefix="$"
        decimalScale={2}
        fixedDecimalScale
        onValueChange={(values) => setValue(values.floatValue)}
        style={{
          background: '#222',
          color: '#fff',
          border: '1px solid #444',
          borderRadius: 4,
          padding: '4px 8px',
          fontSize: 13,
        }}
      />
      <div style={{ fontSize: 11, color: '#888' }}>
        Raw value: {value}
      </div>
    </div>
  );
}

TestComponent.packageName = 'react-number-format';
TestComponent.downloads = '2.9M/week';
export default TestComponent;
