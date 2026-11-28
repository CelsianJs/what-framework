// The virtualized grid.
//
// Only the rows in and near the viewport exist in the DOM: a sizer as tall as
// every row together gives the scrollbar its length, and a window translated to
// the first rendered row holds the slice. Scrolling moves the slice; the rows
// it keeps are keyed by id, so they are moved, not rebuilt.

import { useMemo, useState } from 'what-framework';

import { useGrid } from './grid-store.js';
import { count, money } from './data.js';

export const ROW_HEIGHT = 32;
const VIEWPORT_HEIGHT = 544;
const OVERSCAN = 6;

const COLUMNS = [
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'Item', editable: true },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'status', label: 'Status' },
  { key: 'qty', label: 'Qty', numeric: true, editable: true, format: count },
  { key: 'price', label: 'Unit price', numeric: true, editable: true, format: money },
];

function EditableCell({ row, column }) {
  const grid = useGrid();
  const editing = () => grid.editing?.id === row.id && grid.editing?.key === column.key;

  const onKeyDown = (e) => {
    if (e.key === 'Enter') grid.commitEdit(row.id, column.key, e.currentTarget.value);
    else if (e.key === 'Escape') grid.cancelEdit();
  };

  return (
    <div
      class={column.numeric ? 'cell num editable' : 'cell editable'}
      data-cell={column.key}
      onDoubleClick={() => grid.startEdit(row.id, column.key)}
    >
      {editing() ? (
        <input
          class="cell-input"
          data-cell-input
          defaultValue={row[column.key]}
          ref={(el) => queueMicrotask(() => { el.focus(); el.select(); })}
          onKeyDown={onKeyDown}
          onBlur={(e) => grid.commitEdit(row.id, column.key, e.currentTarget.value)}
        />
      ) : (
        <span>{column.format ? column.format(row[column.key]) : row[column.key]}</span>
      )}
    </div>
  );
}

function Row({ row }) {
  const grid = useGrid();
  return (
    <div class={grid.selected.has(row.id) ? 'row selected' : 'row'} role="row" data-row={row.id}>
      <div class="cell check">
        <input
          type="checkbox"
          aria-label={`Select ${row.sku}`}
          checked={grid.selected.has(row.id)}
          onChange={() => grid.toggle(row.id)}
        />
      </div>
      {COLUMNS.map((column) => (column.editable
        ? <EditableCell row={row} column={column} />
        : (
          <div class={column.key === 'status' ? `cell status status-${row.status.replace(' ', '-')}` : 'cell'} data-cell={column.key}>
            {row[column.key]}
          </div>
        )))}
    </div>
  );
}

export function Grid() {
  const grid = useGrid();
  const [scrollTop, setScrollTop] = useState(0);

  const range = useMemo(() => {
    const total = grid.view.length;
    const start = Math.max(0, Math.floor(scrollTop() / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(total, Math.ceil((scrollTop() + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
    return { start, end, total };
  });
  const visible = useMemo(() => grid.view.slice(range().start, range().end));

  const arrow = (key) => () => (grid.sortKey === key ? (grid.sortDir === 'asc' ? '▲' : '▼') : '');

  return (
    <div class="grid" role="grid" aria-rowcount={() => range().total}>
      <div class="row head" role="row">
        <div class="cell check">
          <input
            type="checkbox"
            data-select-all
            aria-label="Select every row shown"
            checked={() => grid.allVisibleSelected}
            onChange={() => grid.toggleAll()}
          />
        </div>
        {COLUMNS.map((column) => (
          <div class={column.numeric ? 'cell num' : 'cell'} role="columnheader">
            <button data-sort={column.key} onClick={() => grid.sortBy(column.key)}>
              {column.label} <span class="arrow">{arrow(column.key)}</span>
            </button>
          </div>
        ))}
      </div>

      <div
        class="viewport"
        data-viewport
        style={{ height: `${VIEWPORT_HEIGHT}px` }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div class="sizer" style={{ height: `${range().total * ROW_HEIGHT}px` }}>
          <div class="window" data-window style={{ transform: `translateY(${range().start * ROW_HEIGHT}px)` }}>
            {visible().map((row) => <Row key={row.id} row={row} />)}
          </div>
        </div>
      </div>

      <div class="row foot" role="row" data-summary>
        <div class="cell check" />
        <div class="cell" data-sum-rows>{() => `${count(grid.summary.rows)} rows`}</div>
        <div class="cell" />
        <div class="cell" />
        <div class="cell" data-sum-low>{() => `${count(grid.summary.low)} low`}</div>
        <div class="cell num" data-sum-qty>{() => count(grid.summary.qty)}</div>
        <div class="cell num" data-sum-value>{() => money(grid.summary.value)}</div>
      </div>
    </div>
  );
}
