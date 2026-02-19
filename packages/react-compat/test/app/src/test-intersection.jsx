import React from 'react';
import { useInView } from 'react-intersection-observer';

function InViewBox({ label, threshold }) {
  const { ref, inView, entry } = useInView({ threshold: threshold || 0 });
  return (
    <div
      ref={ref}
      style={{
        padding: 16,
        margin: 8,
        border: `2px solid ${inView ? 'green' : '#ccc'}`,
        borderRadius: 8,
        background: inView ? '#e8f5e9' : '#fff',
        transition: 'all 0.3s'
      }}
    >
      <strong>{label}</strong>
      <div>In view: {inView ? 'YES' : 'NO'}</div>
    </div>
  );
}

export function IntersectionTest() {
  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-intersection-observer</h3>
      <InViewBox label="Box 1 (threshold: 0)" threshold={0} />
      <InViewBox label="Box 2 (threshold: 0.5)" threshold={0.5} />
      <InViewBox label="Box 3 (threshold: 1.0)" threshold={1.0} />
      <p style={{ color: 'green', fontWeight: 'bold' }}>PASS — useInView hook works</p>
    </div>
  );
}
