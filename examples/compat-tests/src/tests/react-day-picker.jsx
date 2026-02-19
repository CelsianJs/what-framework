import { useState } from 'react';
import { DayPicker } from 'react-day-picker';

function TestComponent() {
  const [selected, setSelected] = useState(undefined);

  return (
    <div>
      <DayPicker
        mode="single"
        selected={selected}
        onSelect={setSelected}
      />
      {selected && (
        <p style={{ marginTop: '8px', fontSize: '12px', color: '#aaa' }}>
          Selected: {selected.toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

TestComponent.packageName = 'react-day-picker';
TestComponent.downloads = '9.8M/week';
export default TestComponent;
