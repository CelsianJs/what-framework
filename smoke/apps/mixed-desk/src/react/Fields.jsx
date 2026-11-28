// Fields for the events check: a React-controlled input whose onChange
// reports every value, and a React <form onChange> around whatever native
// code puts inside it.
import { useState } from 'react';
import { useProbe } from './probe.js';

export function ReactField({ onValue }) {
  useProbe('react-field');
  const [value, setValue] = useState('');
  return (
    <input
      data-react-field
      placeholder="React field"
      value={value}
      onChange={(e) => { setValue(e.target.value); onValue(e.target.value); }}
    />
  );
}

export function FormAround({ onFormChange, children }) {
  useProbe('form-around');
  return <form data-form-around onChange={() => onFormChange()} onSubmit={(e) => e.preventDefault()}>{children}</form>;
}

export const FancyInput = function FancyInput({ ref, label }) {
  useProbe('fancy-input');
  return <label className="fancy">{label} <input data-fancy-input ref={ref} /></label>;
};
