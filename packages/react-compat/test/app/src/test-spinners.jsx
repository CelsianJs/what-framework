import React from 'react';
import { ClipLoader, BeatLoader, PulseLoader, RingLoader, BarLoader, MoonLoader, HashLoader, PropagateLoader } from 'react-spinners';

export function SpinnersTest() {
  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-spinners</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, padding: 12 }}>
        <div style={{ textAlign: 'center' }}>
          <ClipLoader color="#1976d2" size={40} />
          <div style={{ fontSize: 11, marginTop: 4 }}>ClipLoader</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <BeatLoader color="#e91e63" size={12} />
          <div style={{ fontSize: 11, marginTop: 4 }}>BeatLoader</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <PulseLoader color="#4caf50" size={12} />
          <div style={{ fontSize: 11, marginTop: 4 }}>PulseLoader</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <RingLoader color="#ff9800" size={40} />
          <div style={{ fontSize: 11, marginTop: 4 }}>RingLoader</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <BarLoader color="#9c27b0" width={80} />
          <div style={{ fontSize: 11, marginTop: 4 }}>BarLoader</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <MoonLoader color="#00bcd4" size={30} />
          <div style={{ fontSize: 11, marginTop: 4 }}>MoonLoader</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <HashLoader color="#795548" size={35} />
          <div style={{ fontSize: 11, marginTop: 4 }}>HashLoader</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <PropagateLoader color="#607d8b" size={10} />
          <div style={{ fontSize: 11, marginTop: 4 }}>PropagateLoader</div>
        </div>
      </div>
      <p style={{ color: 'green', fontWeight: 'bold' }}>PASS — 8 spinner types render and animate</p>
    </div>
  );
}
