import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

// How many rows are mounted right now, counted by their effects.
const live = { rows: 0 };
globalThis.__tvLive = live;

// A row with state of its own: it can grow, and the virtualizer measures it
// again through the ref it hands out (`measure`).
function Row({ item, measure, onPick }) {
  const [tall, setTall] = useState(false);
  useEffect(() => { live.rows++; return () => { live.rows--; }; }, []);
  return (
    <div
      className="tv-row"
      data-index={item.index}
      data-tall={tall}
      ref={measure}
      onClick={() => onPick(item.index)}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: tall ? 120 : (item.index % 2 ? 30 : 50), transform: `translateY(${item.start}px)` }}
    >
      Row {item.index}
      {/* The row's own click handler must not hear this one. */}
      <button className="tv-grow" onClick={(e) => { e.stopPropagation(); setTall(!tall); }}>grow</button>
    </div>
  );
}

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
          {items.map((item) => <Row key={item.key} item={item} measure={virtualizer.measureElement} onPick={setSelected} />)}
        </div>
      </div>
    </div>
  );
}
