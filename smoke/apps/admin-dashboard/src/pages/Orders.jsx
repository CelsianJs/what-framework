// Orders.
//
// The sortable table is the keyed-reconciliation proof. `.map()` returning JSX
// with a `key` prop is lowered by what-compiler to mapArray({ key, raw: true }),
// which MOVES existing rows on a reorder instead of tearing the list down. The
// smoke check stamps a JS property on each <tr>, sorts by a different column,
// and asserts the same node objects came back in a new order.
//
// This only works because the app is compiled. The runtime h() path never reads
// vnode.key (smoke/FINDINGS.md A), so the same table in a buildless app would
// recreate every row.

import { computed, signal } from 'what-framework';
import { navigate } from 'what-router';

import { ORDERS, formatMoney } from '../data.js';

const COLUMNS = [
  { key: 'id', label: 'Order', numeric: false },
  { key: 'customer', label: 'Customer', numeric: false },
  { key: 'region', label: 'Region', numeric: false },
  { key: 'status', label: 'Status', numeric: false },
  { key: 'placed', label: 'Placed', numeric: false },
  { key: 'total', label: 'Total', numeric: true },
];

export default function Orders() {
  const sortKey = signal('id', 'orders:sortKey');
  const sortDir = signal('asc', 'orders:sortDir');

  const sorted = computed(() => {
    const key = sortKey();
    const dir = sortDir() === 'asc' ? 1 : -1;
    return [...ORDERS].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  });

  function sortBy(key) {
    if (sortKey() === key) sortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      sortKey(key);
      // Money reads best largest-first; everything else reads best A to Z.
      sortDir(key === 'total' ? 'desc' : 'asc');
    }
  }

  const ariaSort = (key) => () => {
    if (sortKey() !== key) return 'none';
    return sortDir() === 'asc' ? 'ascending' : 'descending';
  };

  return (
    <>
      <div class="page-head">
        <div>
          <h1>Orders</h1>
          <p>Click a column to re-sort, click a row to open it.</p>
        </div>
      </div>

      <div class="card">
        <table data-orders-table>
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key} class={col.numeric ? 'num' : ''} aria-sort={ariaSort(col.key)}>
                  <button data-sort={col.key} onclick={() => sortBy(col.key)}>
                    {col.label}
                    <span class="mono">{() => (sortKey() === col.key ? (sortDir() === 'asc' ? '▲' : '▼') : '')}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-orders-body>
            {() => sorted().map((o) => (
              <tr key={o.id} data-row={o.id} onclick={() => navigate(`/orders/${o.id}`)}>
                <td class="mono">{o.id}</td>
                <td>{o.customer}</td>
                <td>{o.region}</td>
                <td><span class={`pill ${o.status}`}>{o.status}</span></td>
                <td class="muted">{o.placed}</td>
                <td class="num">{formatMoney(o.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
