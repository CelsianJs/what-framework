import { useState } from 'react';
import { List, useListRef } from 'react-window';
import { Row } from './parts.jsx';

export default function Fixture() {
  const [selected, setSelected] = useState(-1);
  const [count, setCount] = useState(5000);
  const listRef = useListRef(null);
  return (
    <div>
      <button id="rw-jump" onClick={() => listRef.current.scrollToRow({ index: 3000, align: 'start' })}>jump</button>
      <button id="rw-shrink" onClick={() => setCount(4)}>4 rows</button>
      <span id="rw-selected">{selected}</span>
      <List
        id="rw-list"
        listRef={listRef}
        rowComponent={Row}
        rowCount={count}
        rowHeight={25}
        rowProps={{ selected, onPick: setSelected }}
        style={{ height: 250, width: 300 }}
      />
    </div>
  );
}
