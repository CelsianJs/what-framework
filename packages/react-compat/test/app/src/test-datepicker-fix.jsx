import React, { useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

function App() {
  const [date, setDate] = useState(new Date());
  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: 500, margin: '0 auto' }}>
      <h2>react-datepicker — Fix Test</h2>
      <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
        <DatePicker selected={date} onChange={setDate} />
        <p>Selected: {date?.toLocaleDateString()}</p>
        <p style={{ color: 'green', fontWeight: 'bold' }}>PASS — react-datepicker works</p>
      </div>
    </div>
  );
}

import { createRoot } from 'react-dom/client';
const root = createRoot(document.getElementById('app'));
root.render(<App />);
