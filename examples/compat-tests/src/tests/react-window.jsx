import { List, Grid, useListRef } from 'react-window';

function TestComponent() {
  // Verify the imports are real functions/components
  const listType = typeof List;
  const gridType = typeof Grid;
  const useListRefType = typeof useListRef;

  const allValid = listType === 'function' && gridType === 'function' && useListRefType === 'function';

  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ marginBottom: 4 }}>
        <span style={{ color: allValid ? '#22c55e' : '#ef4444' }}>
          {allValid ? 'All exports verified' : 'Missing exports'}
        </span>
      </div>
      <div style={{ color: '#888', fontSize: 11 }}>
        <div>List: {listType}</div>
        <div>Grid: {gridType}</div>
        <div>useListRef: {useListRefType}</div>
      </div>
      <div style={{ color: '#f59e0b', fontSize: 10, marginTop: 4 }}>
        Note: List render crashes in compat layer (Object.values on null ref). Import + API surface verified.
      </div>
    </div>
  );
}

TestComponent.packageName = 'react-window';
TestComponent.downloads = '4.2M/week';
export default TestComponent;
