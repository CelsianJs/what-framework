// 10,000 deals from one store signal: a react-window list (native code
// holds its imperative handle) and a TanStack table of the largest, which
// a native checkbox mounts and unmounts.

import { signal } from 'what-framework';
import { List } from 'react-window';

import { deals } from '../store.js';
import { DealRow } from '../react/DealRow.jsx';
import { DealsTable } from '../react/DealsTable.jsx';

export const showTable = signal(true);

export function Deals() {
  const listRef = { current: null };
  return (
    <section data-route="deals">
      <h1>Deals <small data-deal-count>{deals().length}</small></h1>
      <button type="button" data-jump onClick={() => listRef.current.scrollToRow({ index: 5000, align: 'start' })}>Jump to deal 5000</button>
      <div class="deal-list" data-deal-list>
        <List listRef={listRef} rowComponent={DealRow} rowCount={deals().length} rowHeight={28} rowProps={{ deals: deals() }} style={{ height: 336 }} />
      </div>
      <label><input type="checkbox" data-show-table checked={showTable()} onChange={(e) => showTable(e.target.checked)} /> Largest deals</label>
      {showTable() ? <DealsTable deals={deals()} /> : null}
    </section>
  );
}
