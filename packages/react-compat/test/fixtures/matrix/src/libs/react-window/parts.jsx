/** @jsxImportSource react */
// A component handed to a React package as a prop (`rowComponent`) is rendered
// by React, so it comes from a React file. The fixture and its native variant
// share this one.
import { useEffect, useState } from 'react';

// How many rows are mounted right now, counted by their effects.
const live = { rows: 0 };
globalThis.__rwLive = live;

export function Row({ index, style, selected, onPick }) {
  const [starred, setStarred] = useState(false);
  useEffect(() => { live.rows++; return () => { live.rows--; }; }, []);
  return (
    <div className="rw-row" data-index={index} data-starred={starred} style={style} aria-selected={selected === index} onClick={() => onPick(index)}>
      Row {index}{selected === index ? ' *' : ''}
      {/* The row's own click handler must not hear this one. */}
      <button className="rw-star" onClick={(e) => { e.stopPropagation(); setStarred(!starred); }}>{starred ? 'starred' : 'star'}</button>
    </div>
  );
}
