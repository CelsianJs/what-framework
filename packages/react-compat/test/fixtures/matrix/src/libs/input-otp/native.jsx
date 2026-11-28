// fixture.jsx as a native What file: the value is a signal, <OTPInput> is an island.
import { signal } from 'what-framework';
import { OTPInput, REGEXP_ONLY_DIGITS } from 'input-otp';

export default function Native() {
  const value = signal('');
  const done = signal('');
  return (
    <div>
      <OTPInput
        id="otp"
        maxLength={4}
        pattern={REGEXP_ONLY_DIGITS}
        value={value()}
        onChange={(next) => value(next)}
        onComplete={(code) => done(code)}
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
      <span id="otp-value">{value()}</span>
      <span id="otp-done">{done()}</span>
      <button id="otp-clear" onClick={() => value('')}>clear</button>
    </div>
  );
}
