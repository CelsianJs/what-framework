import React, { useState } from 'react';
import Select from 'react-select';

const options = [
  { value: 'chocolate', label: 'Chocolate' },
  { value: 'strawberry', label: 'Strawberry' },
  { value: 'vanilla', label: 'Vanilla' },
  { value: 'mint', label: 'Mint' },
  { value: 'coffee', label: 'Coffee' },
];

function App() {
  const [selected, setSelected] = useState(null);
  const [multi, setMulti] = useState([]);

  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 500, margin: '0 auto' }}>
      <h2>react-select — Fix Test</h2>
      <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
        <h3>Single Select</h3>
        <Select
          value={selected}
          onChange={setSelected}
          options={options}
          placeholder="Choose a flavor..."
        />
        {selected && <p>Selected: {selected.label}</p>}

        <h3 style={{ marginTop: 16 }}>Multi Select</h3>
        <Select
          isMulti
          value={multi}
          onChange={setMulti}
          options={options}
          placeholder="Choose flavors..."
        />
        {multi.length > 0 && <p>Selected: {multi.map(m => m.label).join(', ')}</p>}
        <p style={{ marginTop: 12, color: 'green', fontWeight: 'bold' }}>PASS — react-select works</p>
      </div>
    </div>
  );
}

import { createRoot } from 'react-dom/client';
const root = createRoot(document.getElementById('app'));
root.render(<App />);
