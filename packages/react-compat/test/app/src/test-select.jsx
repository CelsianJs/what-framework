/**
 * Test: react-select — flexible select/dropdown component
 * 5.1M weekly downloads. Refs, portals, render props.
 */
import Select from 'react-select';
import { useState } from 'react';

const options = [
  { value: 'react', label: 'React' },
  { value: 'vue', label: 'Vue' },
  { value: 'angular', label: 'Angular' },
  { value: 'svelte', label: 'Svelte' },
  { value: 'what', label: 'What Framework' },
  { value: 'solid', label: 'SolidJS' },
  { value: 'qwik', label: 'Qwik' },
];

export function SelectTest() {
  const [selected, setSelected] = useState(null);
  const [multi, setMulti] = useState([]);

  return (
    <div style={{ maxWidth: '400px' }}>
      <div style={{ marginBottom: '12px' }}>
        <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '4px' }}>Single select:</label>
        <Select
          options={options}
          value={selected}
          onChange={setSelected}
          placeholder="Choose a framework..."
        />
        {selected && <p style={{ fontSize: '13px', marginTop: '4px' }}>Selected: {selected.label}</p>}
      </div>
      <div>
        <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '4px' }}>Multi select:</label>
        <Select
          isMulti
          options={options}
          value={multi}
          onChange={setMulti}
          placeholder="Choose frameworks..."
        />
        {multi.length > 0 && <p style={{ fontSize: '13px', marginTop: '4px' }}>Selected: {multi.map(m => m.label).join(', ')}</p>}
      </div>
      <p style={{ color: 'green' }} id="select-status">React Select loaded OK</p>
    </div>
  );
}
