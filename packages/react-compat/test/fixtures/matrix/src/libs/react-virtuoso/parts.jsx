/** @jsxImportSource react */
// A row with state and an effect is rendered by React, so it comes from a
// React file. The fixture and its native variant share this one.
import { useEffect, useState } from 'react';

// How many rows are mounted right now, counted by their effects.
const live = { rows: 0 };
globalThis.__rvLive = live;

export function Item({ index, onPick }) {
  const [starred, setStarred] = useState(false);
  useEffect(() => { live.rows++; return () => { live.rows--; }; }, []);
  return (
    <div className="rv-row" data-index={index} data-starred={starred} style={{ height: index % 3 === 0 ? 40 : 24 }} onClick={() => onPick(index)}>
      Item {index}
      {/* The row's own click handler must not hear this one. */}
      <button className="rv-star" onClick={(e) => { e.stopPropagation(); setStarred(!starred); }}>star</button>
    </div>
  );
}
