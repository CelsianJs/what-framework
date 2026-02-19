import { useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

export function TextareaTest() {
  const [val, setVal] = useState('');
  return (
    <div>
      <TextareaAutosize
        minRows={2}
        maxRows={8}
        placeholder="Type here — textarea grows automatically..."
        value={val}
        onChange={e => setVal(e.target.value)}
        style={{
          width: '100%', maxWidth: '400px', padding: '8px',
          borderRadius: '6px', border: '1px solid #666',
          fontFamily: 'inherit', fontSize: '14px', resize: 'none'
        }}
      />
      <p style={{ color: '#888', marginTop: '4px' }}>{val.split('\n').length} line(s), {val.length} chars</p>
      <p style={{ color: 'green' }}>react-textarea-autosize with min/max rows</p>
    </div>
  );
}
