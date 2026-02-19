/**
 * Test: @tanstack/react-virtual — headless virtual scrolling
 * 2.8M weekly downloads. Hooks-only (useVirtualizer).
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

export function VirtualTest() {
  const parentRef = useRef(null);

  const rowVirtualizer = useVirtualizer({
    count: 10000,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35,
  });

  return (
    <div>
      <p style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>
        Virtualizing 10,000 rows (only visible rows in DOM):
      </p>
      <div
        ref={parentRef}
        style={{ height: '200px', overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: '6px' }}
      >
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map(virtualRow => (
            <div
              key={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                borderBottom: '1px solid #f3f4f6',
                background: virtualRow.index % 2 ? '#fafafa' : 'white',
                fontSize: '13px',
              }}
            >
              Row {virtualRow.index + 1} of 10,000
            </div>
          ))}
        </div>
      </div>
      <p style={{ color: 'green' }} id="virtual-status">TanStack Virtual loaded OK</p>
    </div>
  );
}
