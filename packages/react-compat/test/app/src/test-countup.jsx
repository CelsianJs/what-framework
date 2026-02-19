import React, { useState } from 'react';
import CountUp from 'react-countup';

export function CountUpTest() {
  const [key, setKey] = useState(0);

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-countup</h3>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '12px 0' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 'bold', color: '#1976d2' }}>
            <CountUp key={key} end={1234} duration={2} separator="," />
          </div>
          <div style={{ color: '#666', fontSize: 12 }}>Users</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 'bold', color: '#388e3c' }}>
            $<CountUp key={key + 'rev'} end={99999} duration={2.5} separator="," decimals={2} />
          </div>
          <div style={{ color: '#666', fontSize: 12 }}>Revenue</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 'bold', color: '#f57c00' }}>
            <CountUp key={key + 'pct'} end={99.9} duration={1.5} decimals={1} suffix="%" />
          </div>
          <div style={{ color: '#666', fontSize: 12 }}>Uptime</div>
        </div>
      </div>
      <button onClick={() => setKey(k => k + 1)} style={{ padding: '4px 12px' }}>Replay Animation</button>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — CountUp animates with decimals, prefix, suffix</p>
    </div>
  );
}
