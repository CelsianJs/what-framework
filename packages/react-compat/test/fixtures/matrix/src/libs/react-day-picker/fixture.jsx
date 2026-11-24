import { useState } from 'react';
import { DayPicker } from 'react-day-picker';

const iso = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : 'none');

export default function Fixture() {
  const [selected, setSelected] = useState(undefined);
  const [range, setRange] = useState(undefined);
  return (
    <div>
      <div id="dp-single">
        <DayPicker mode="single" selected={selected} onSelect={setSelected} defaultMonth={new Date(2026, 0, 1)} />
      </div>
      <span id="dp-selected">{iso(selected)}</span>
      <div id="dp-range">
        <DayPicker mode="range" selected={range} onSelect={setRange} defaultMonth={new Date(2026, 5, 1)} disabled={{ dayOfWeek: [0] }} />
      </div>
      <span id="dp-range-value">{range ? `${iso(range.from)}..${iso(range.to)}` : 'none'}</span>
    </div>
  );
}
