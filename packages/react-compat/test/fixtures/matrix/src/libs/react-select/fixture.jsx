import { useState } from 'react';
import Select from 'react-select';
import AsyncSelect from 'react-select/async';

const flavours = [
  { value: 'chocolate', label: 'Chocolate' },
  { value: 'strawberry', label: 'Strawberry' },
  { value: 'vanilla', label: 'Vanilla' },
];
const load = (input) => new Promise((resolve) => setTimeout(() => resolve(flavours.filter((f) => f.label.toLowerCase().includes(input.toLowerCase()))), 40));

export default function Fixture() {
  const [one, setOne] = useState(null);
  const [many, setMany] = useState([]);
  const [remote, setRemote] = useState(null);
  return (
    <div style={{ width: 320 }}>
      <Select inputId="rs-input" instanceId="rs" classNamePrefix="rs" options={flavours} value={one} onChange={setOne} isClearable menuPortalTarget={document.body} />
      <span id="rs-one">{one ? one.value : 'none'}</span>
      <Select inputId="rsm-input" instanceId="rsm" classNamePrefix="rsm" options={flavours} value={many} onChange={setMany} isMulti />
      <span id="rs-many">{many.map((m) => m.value).join(',') || 'none'}</span>
      <AsyncSelect inputId="rsa-input" instanceId="rsa" classNamePrefix="rsa" loadOptions={load} value={remote} onChange={setRemote} />
      <span id="rs-remote">{remote ? remote.value : 'none'}</span>
    </div>
  );
}
