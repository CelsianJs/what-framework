// Store — global state with derived values and actions
// Uses createStore for state that multiple components share.

import { createStore, derived } from 'what-framework';

const STORAGE_KEY = 'what-contacts';

function loadContacts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch { return []; }
}

export const useContacts = createStore({
  contacts: loadContacts(),
  search: '',
  sortBy: 'name', // 'name' | 'recent'

  // Derived values — recompute automatically when dependencies change
  filtered: derived(s => {
    let list = s.contacts;
    if (s.search) {
      const q = s.search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
      );
    }
    if (s.sortBy === 'name') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    } else {
      list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    }
    return list;
  }),

  count: derived(s => s.contacts.length),

  // Actions — use `this` to read/write state
  add(contact) {
    this.contacts = [
      { ...contact, id: Date.now(), createdAt: Date.now() },
      ...this.contacts,
    ];
    this._persist();
  },

  update(id, updates) {
    this.contacts = this.contacts.map(c =>
      c.id === id ? { ...c, ...updates } : c
    );
    this._persist();
  },

  remove(id) {
    this.contacts = this.contacts.filter(c => c.id !== id);
    this._persist();
  },

  setSearch(q) {
    this.search = q;
  },

  setSortBy(s) {
    this.sortBy = s;
  },

  _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.contacts));
    } catch {}
  },
});
