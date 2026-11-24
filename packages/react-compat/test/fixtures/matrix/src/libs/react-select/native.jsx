// fixture.jsx as a native What file: signals for the values, the selects are islands.
import { signal } from 'what-framework';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';

const flavours = [
  { value: 'chocolate', label: 'Chocolate' },
  { value: 'strawberry', label: 'Strawberry' },
  { value: 'vanilla', label: 'Vanilla' },
];
const load = (input) => new Promise((resolve) => setTimeout(() => resolve(flavours.filter((f) => f.label.toLowerCase().includes(input.toLowerCase()))), 40));

export default function Native() {
  const one = signal(null);
  const many = signal([]);
  const remote = signal(null);
  return (
    <div style={{ width: '320px' }}>
      <Select inputId="rs-input" instanceId="rs" classNamePrefix="rs" options={flavours} value={one()} onChange={(next) => one(next)} isClearable menuPortalTarget={document.body} />
      <span id="rs-one">{one() ? one().value : 'none'}</span>
      <Select inputId="rsm-input" instanceId="rsm" classNamePrefix="rsm" options={flavours} value={many()} onChange={(next) => many(next)} isMulti />
      <span id="rs-many">{many().map((m) => m.value).join(',') || 'none'}</span>
      <AsyncSelect inputId="rsa-input" instanceId="rsa" classNamePrefix="rsa" loadOptions={load} value={remote()} onChange={(next) => remote(next)} />
      <span id="rs-remote">{remote() ? remote().value : 'none'}</span>
    </div>
  );
}
