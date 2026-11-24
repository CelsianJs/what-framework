import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export default function Fixture() {
  const parentRef = useRef(null);
  const [count, setCount] = useState(10000);
  const [selected, setSelected] = useState(-1);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (i % 2 ? 30 : 50),
    overscan: 3,
  });
  const items = virtualizer.getVirtualItems();
  return (
    <div>
      <button id="tv-jump" onClick={() => virtualizer.scrollToIndex(5000, { align: 'start' })}>jump to 5000</button>
      <button id="tv-shrink" onClick={() => setCount(20)}>20 rows</button>
      <span id="tv-total">{virtualizer.getTotalSize()}</span>
      <span id="tv-selected">{selected}</span>
      <div id="tv-scroll" ref={parentRef} style={{ height: 300, width: 300, overflow: 'auto' }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((item) => (
            <div
              key={item.key}
              className="tv-row"
              data-index={item.index}
              ref={virtualizer.measureElement}
              onClick={() => setSelected(item.index)}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: item.index % 2 ? 30 : 50, transform: `translateY(${item.start}px)` }}
            >
              Row {item.index}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
