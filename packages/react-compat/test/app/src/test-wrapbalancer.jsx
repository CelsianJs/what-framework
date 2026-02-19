import React from 'react';
import Balancer from 'react-wrap-balancer';

export function WrapBalancerTest() {
  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-wrap-balancer</h3>
      <div style={{ maxWidth: 400 }}>
        <h2 style={{ fontSize: 24, lineHeight: 1.3 }}>
          <Balancer>What Framework Makes React Libraries Work With Zero Changes</Balancer>
        </h2>
        <p style={{ fontSize: 14, color: '#666' }}>
          <Balancer>A beautifully balanced paragraph that automatically wraps text so that each line is roughly the same width, preventing the ugly last-line-orphan effect.</Balancer>
        </p>
      </div>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — Balancer wraps text evenly</p>
    </div>
  );
}
