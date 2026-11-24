import { useRef, useState } from 'react';
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
  const [lock, setLock] = useState(false);
  const [log, setLog] = useState([]);
  const select = useRef(null);
  const note = (name) => setLog((list) => [...list, name]);
  return (
    <div style={{ width: 320 }}>
      <Select
        ref={select}
        inputId="rs-input"
        instanceId="rs"
        classNamePrefix="rs"
        options={flavours}
        value={one}
        onChange={setOne}
        isClearable
        menuPortalTarget={document.body}
        onMenuOpen={() => note('open')}
        onMenuClose={() => note('close')}
        // react-select leaves a key alone when the handler it was given prevented its default.
        onKeyDown={(e) => { if (lock && e.key === 'Enter') e.preventDefault(); }}
      />
      <span id="rs-one">{one ? one.value : 'none'}</span>
      <button id="rs-focus" onClick={() => select.current.focus()}>focus the select</button>
      <button id="rs-lock" aria-pressed={lock} onClick={() => setLock(!lock)}>lock Enter</button>
      <span id="rs-log">{log.join(',')}</span>
      <Select inputId="rsm-input" instanceId="rsm" classNamePrefix="rsm" options={flavours} value={many} onChange={setMany} isMulti />
      <span id="rs-many">{many.map((m) => m.value).join(',') || 'none'}</span>
      <AsyncSelect inputId="rsa-input" instanceId="rsa" classNamePrefix="rsa" loadOptions={load} value={remote} onChange={setRemote} />
      <span id="rs-remote">{remote ? remote.value : 'none'}</span>
    </div>
  );
}
