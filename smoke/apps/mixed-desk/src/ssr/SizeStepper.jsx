// A React stepper inside the ticket island: React state, a callback to the
// native ticket, and a free-text note.
import { useState } from 'react';

export function SizeStepper({ start, onFill }) {
  const [size, setSize] = useState(start);
  return (
    <div className="stepper" data-stepper>
      <button type="button" data-step-down onClick={() => setSize(size - 100)}>-</button>
      <output data-step-size>{size}</output>
      <button type="button" data-step-up onClick={() => setSize(size + 100)}>+</button>
      <button type="button" data-fill onClick={() => onFill(size)}>fill</button>
      <input data-ticket-note placeholder="note" />
    </div>
  );
}
