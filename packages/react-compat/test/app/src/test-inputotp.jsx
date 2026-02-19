import { useState } from 'react';
import { OTPInput } from 'input-otp';

export function InputOtpTest() {
  const [value, setValue] = useState('');
  return (
    <div>
      <OTPInput
        maxLength={6}
        value={value}
        onChange={setValue}
        render={({ slots }) => (
          <div style={{ display: 'flex', gap: '6px' }}>
            {slots.map((slot, idx) => (
              <div key={idx} style={{
                width: '40px', height: '48px', borderRadius: '6px',
                border: '2px solid ' + (slot.isActive ? '#3b82f6' : '#ddd'),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '20px', fontWeight: 'bold',
                background: slot.isActive ? '#eff6ff' : 'white',
                color: '#333'
              }}>
                {slot.char || (slot.isActive ? <div style={{ width: '2px', height: '20px', background: '#3b82f6', animation: 'blink 1s step-end infinite' }} /> : null)}
              </div>
            ))}
          </div>
        )}
      />
      {value.length === 6 && <p style={{ marginTop: '4px' }}>Code: {value}</p>}
      <style>{`@keyframes blink { 50% { opacity: 0; } }`}</style>
      <p style={{ color: 'green', marginTop: '4px' }}>input-otp with 6-digit custom rendered slots</p>
    </div>
  );
}
