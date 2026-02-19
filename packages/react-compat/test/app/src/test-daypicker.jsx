import { useState } from 'react';
import { DayPicker } from 'react-day-picker';

export function DayPickerTest() {
  const [selected, setSelected] = useState(null);
  return (
    <div>
      <DayPicker
        mode="single"
        selected={selected}
        onSelect={setSelected}
        style={{ fontSize: '14px' }}
      />
      {selected && <p>Selected: {selected.toLocaleDateString()}</p>}
      <p style={{ color: 'green', marginTop: '4px' }}>react-day-picker with single date selection</p>
    </div>
  );
}
