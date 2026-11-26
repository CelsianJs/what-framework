// Ledger: an inventory grid over 10,000 SKUs. Client-only; index.html ships an
// empty #app.

import './styles.css';

import { mount } from 'what-framework';

import { Grid } from './Grid.jsx';
import { useGrid } from './grid-store.js';
import { WAREHOUSES, count, money } from './data.js';

function Toolbar() {
  const grid = useGrid();
  return (
    <div class="toolbar">
      <input
        type="search"
        data-filter
        placeholder="Filter by item or SKU"
        value={() => grid.query}
        onInput={(e) => grid.setQuery(e.currentTarget.value)}
      />
      <select data-warehouse value={() => grid.warehouse} onChange={(e) => grid.setWarehouse(e.currentTarget.value)}>
        <option value="all">All warehouses</option>
        {WAREHOUSES.map((w) => <option value={w}>{w}</option>)}
      </select>
    </div>
  );
}

function BulkBar() {
  const grid = useGrid();
  return (
    <div class={() => (grid.selection.count ? 'bulk on' : 'bulk')} data-bulk>
      <span data-selected-count>{() => `${count(grid.selection.count)} selected`}</span>
      <span class="muted" data-selected-value>{() => money(grid.selection.value)}</span>
      <button data-reprice disabled={() => grid.selection.count === 0} onClick={() => grid.reprice(10)}>Raise price 10%</button>
      <button data-clear disabled={() => grid.selection.count === 0} onClick={() => grid.clearSelection()}>Clear</button>
      <span class="muted" data-last-bulk>
        {() => (grid.lastBulk ? `Repriced ${count(grid.lastBulk.changed)} rows by ${grid.lastBulk.percent}%` : '')}
      </span>
    </div>
  );
}

function App() {
  return (
    <main class="page">
      <header class="masthead">
        <h1>Ledger</h1>
        <p>Ten warehouses, ten thousand SKUs. Double-click an item, a quantity or a price to edit it.</p>
      </header>
      <Toolbar />
      <BulkBar />
      <Grid />
    </main>
  );
}

mount(<App />, '#app');
