// The grid's state, one module-scoped store.
//
// Rows are immutable records: an edit replaces one row object and the array
// around it, as a React reducer would. Everything else the screen shows is
// derived: the filtered and sorted view, the summary over the whole view and
// the summary over the selection.

import { createStore, derived } from 'what-framework';

import { makeRows } from './data.js';

const compare = (key, dir) => (a, b) => {
  const av = a[key];
  const bv = b[key];
  const order = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
  return (order || a.id - b.id) * dir;
};

export const useGrid = createStore({
  rows: makeRows(),
  sortKey: 'id',
  sortDir: 'asc',
  query: '',
  warehouse: 'all',
  selected: new Set(),
  editing: null, // { id, key } of the cell being edited
  lastBulk: null,

  view: derived((s) => {
    const q = s.query.trim().toLowerCase();
    const wh = s.warehouse;
    let out = s.rows;
    if (wh !== 'all' || q) {
      out = out.filter((r) => (wh === 'all' || r.warehouse === wh)
        && (!q || r.name.includes(q) || r.sku.toLowerCase().includes(q)));
    }
    if (s.sortKey === 'id' && s.sortDir === 'asc') return out;
    return [...out].sort(compare(s.sortKey, s.sortDir === 'asc' ? 1 : -1));
  }),

  summary: derived((s) => {
    let qty = 0;
    let value = 0;
    let low = 0;
    for (const r of s.view) {
      qty += r.qty;
      value += r.qty * r.price;
      if (r.status === 'low') low++;
    }
    return { rows: s.view.length, qty, value, low };
  }),

  selection: derived((s) => {
    let value = 0;
    let n = 0;
    for (const r of s.rows) {
      if (s.selected.has(r.id)) { n++; value += r.qty * r.price; }
    }
    return { count: n, value };
  }),

  allVisibleSelected: derived((s) => s.view.length > 0 && s.view.every((r) => s.selected.has(r.id))),

  sortBy(key) {
    if (this.sortKey === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.sortKey = key; this.sortDir = 'asc'; }
  },

  setQuery(q) { this.query = q; },
  setWarehouse(w) { this.warehouse = w; },

  toggle(id) {
    const next = new Set(this.selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selected = next;
  },

  toggleAll() {
    if (this.allVisibleSelected) {
      const next = new Set(this.selected);
      for (const r of this.view) next.delete(r.id);
      this.selected = next;
    } else {
      const next = new Set(this.selected);
      for (const r of this.view) next.add(r.id);
      this.selected = next;
    }
  },

  clearSelection() { this.selected = new Set(); },

  startEdit(id, key) { this.editing = { id, key }; },
  cancelEdit() { this.editing = null; },

  // Enter commits and the input's blur that follows finds nothing to commit.
  commitEdit(id, key, raw) {
    if (this.editing?.id !== id || this.editing?.key !== key) return false;
    const value = key === 'name' ? String(raw).trim() : Number(raw);
    if ((key === 'name' && !value) || (key !== 'name' && !Number.isFinite(value))) {
      this.editing = null;
      return false;
    }
    const at = this.rows.findIndex((r) => r.id === id);
    const next = this.rows.slice();
    next[at] = { ...next[at], [key]: key === 'price' ? Math.round(value * 100) / 100 : value };
    this.rows = next;
    this.editing = null;
    return true;
  },

  // Reprice every selected row by a percentage, in one write.
  reprice(percent) {
    const sel = this.selected;
    const factor = 1 + percent / 100;
    let changed = 0;
    this.rows = this.rows.map((r) => {
      if (!sel.has(r.id)) return r;
      changed++;
      return { ...r, price: Math.round(r.price * factor * 100) / 100 };
    });
    this.lastBulk = { changed, percent };
    return changed;
  },
});
