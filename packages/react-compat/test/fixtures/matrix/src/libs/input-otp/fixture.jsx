import { useState } from 'react';
import { OTPInput, REGEXP_ONLY_DIGITS } from 'input-otp';

export default function Fixture() {
  const [value, setValue] = useState('');
  const [done, setDone] = useState('');
  return (
    <div>
      <OTPInput
        id="otp"
        maxLength={4}
        pattern={REGEXP_ONLY_DIGITS}
        value={value}
        onChange={setValue}
        onComplete={setDone}
        render={({ slots }) => (
          <div style={{ display: 'flex', gap: 4 }}>
            {slots.map((slot, i) => (
              <div key={i} className="otp-slot" data-active={slot.isActive} style={{ width: 30, height: 40, border: '1px solid #999' }}>
                {slot.char ?? ''}{slot.hasFakeCaret ? '|' : ''}
              </div>
            ))}
          </div>
        )}
      />
      <span id="otp-value">{value}</span>
      <span id="otp-done">{done}</span>
      <button id="otp-clear" onClick={() => setValue('')}>clear</button>
    </div>
  );
}
