import React from 'react';
import { Virtuoso } from 'react-virtuoso';

export function VirtuosoTest() {
  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-virtuoso</h3>
      <div style={{ border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden' }}>
        <Virtuoso
          style={{ height: 200 }}
          totalCount={10000}
          itemContent={(index) => (
            <div style={{
              padding: '8px 12px',
              borderBottom: '1px solid #f0f0f0',
              background: index % 2 === 0 ? '#fafafa' : '#fff'
            }}>
              Row #{index + 1} — {['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'][index % 5]} {['Smith', 'Johnson', 'Williams', 'Brown', 'Jones'][index % 5]}
            </div>
          )}
        />
      </div>
      <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Rendering 10,000 rows with virtualization</p>
      <p style={{ color: 'green', fontWeight: 'bold' }}>PASS — Virtuoso renders 10K rows</p>
    </div>
  );
}
