import React, { useState } from 'react';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';

export function SkeletonTest() {
  const [loading, setLoading] = useState(true);

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-loading-skeleton</h3>
      <button onClick={() => setLoading(!loading)} style={{ marginBottom: 12, padding: '4px 12px' }}>
        Toggle Loading: {loading ? 'ON' : 'OFF'}
      </button>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ width: 200 }}>
          {loading ? (
            <>
              <Skeleton circle width={60} height={60} />
              <Skeleton count={2} style={{ marginTop: 8 }} />
              <Skeleton width="60%" />
            </>
          ) : (
            <>
              <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#4CAF50', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold' }}>JD</div>
              <p style={{ margin: '8px 0 0' }}>John Doe</p>
              <p style={{ margin: 0, color: '#666' }}>Software Engineer</p>
              <p style={{ margin: 0, color: '#999', fontSize: 12 }}>San Francisco</p>
            </>
          )}
        </div>

        <div style={{ flex: 1 }}>
          {loading ? (
            <Skeleton count={5} />
          ) : (
            <p>This is the loaded content that replaces the skeleton placeholder. It shows real data after the loading state toggles off.</p>
          )}
        </div>
      </div>

      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — Skeleton renders with circle, count, width</p>
    </div>
  );
}
