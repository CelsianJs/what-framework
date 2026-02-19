import { useState } from 'react';
import { NumericFormat, PatternFormat } from 'react-number-format';

export function NumberFormatTest() {
  const [val, setVal] = useState('');
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '300px' }}>
        <label>Currency:
          <NumericFormat
            value={val}
            onValueChange={v => setVal(v.value)}
            thousandSeparator=","
            prefix="$"
            decimalScale={2}
            style={{ marginLeft: '8px', padding: '4px', width: '150px' }}
            placeholder="$0.00"
          />
        </label>
        <label>Phone:
          <PatternFormat
            format="+1 (###) ###-####"
            mask="_"
            style={{ marginLeft: '8px', padding: '4px', width: '180px' }}
            placeholder="+1 (___) ___-____"
          />
        </label>
        <label>Credit Card:
          <PatternFormat
            format="#### #### #### ####"
            mask=" "
            style={{ marginLeft: '8px', padding: '4px', width: '200px' }}
            placeholder="0000 0000 0000 0000"
          />
        </label>
      </div>
      {val && <p style={{ marginTop: '4px' }}>Raw value: {val}</p>}
      <p style={{ color: 'green', marginTop: '4px' }}>NumericFormat + PatternFormat working</p>
    </div>
  );
}
