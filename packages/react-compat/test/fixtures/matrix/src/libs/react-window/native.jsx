// fixture.jsx as a native What file: signals for state, <List> is an island.
import { signal } from 'what-framework';
import { List } from 'react-window';
import { Row } from './parts.jsx';

export default function Native() {
  const selected = signal(-1);
  const count = signal(5000);
  const listRef = { current: null };
  return (
    <div>
      <button id="rw-jump" onClick={() => listRef.current.scrollToRow({ index: 3000, align: 'start' })}>jump</button>
      <button id="rw-shrink" onClick={() => count(4)}>4 rows</button>
      <span id="rw-selected">{selected()}</span>
      <List
        id="rw-list"
        listRef={listRef}
        rowComponent={Row}
        rowCount={count()}
        rowHeight={25}
        rowProps={{ selected: selected(), onPick: (index) => selected(index) }}
        style={{ height: 250, width: 300 }}
      />
    </div>
  );
}
