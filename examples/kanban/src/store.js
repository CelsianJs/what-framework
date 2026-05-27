// Kanban Store — multi-board state with localStorage persistence.
// Demonstrates createStore + derived computeds + actions with `this`.

import { createStore, derived } from 'what-framework';

const STORAGE_KEY = 'what-kanban-v1';

// --- Defaults ---------------------------------------------

function defaultState() {
  const boardId = 'b-' + Date.now().toString(36);
  return {
    boards: [
      {
        id: boardId,
        name: 'My First Board',
        columns: [
          { id: 'c-todo',    name: 'To Do',       cardIds: [] },
          { id: 'c-doing',   name: 'In Progress', cardIds: [] },
          { id: 'c-done',    name: 'Done',        cardIds: [] },
        ],
      },
    ],
    cards: {}, // id -> { id, boardId, title, description, createdAt }
    activeBoardId: boardId,
  };
}

// --- Persistence ------------------------------------------

function loadState() {
  if (typeof localStorage === 'undefined') return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // Basic shape validation
    if (!parsed || !Array.isArray(parsed.boards) || !parsed.cards) {
      return defaultState();
    }
    return parsed;
  } catch {
    return defaultState();
  }
}

function uid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// --- Store ------------------------------------------------

const initial = loadState();

// Synchronous fallback used by unload listener and by tests that need to
// guarantee the latest snapshot is on disk before reading it back.
function flushNow(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    const snap = {
      boards: state.boards,
      cards: state.cards,
      activeBoardId: state.activeBoardId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {}
}

export const useKanban = createStore({
  boards: initial.boards,
  cards: initial.cards,
  activeBoardId: initial.activeBoardId,

  // ---- Derived computeds ----

  activeBoard: derived(s => s.boards.find(b => b.id === s.activeBoardId) || s.boards[0] || null),

  cardCount: derived(s => Object.keys(s.cards).length),

  boardCardCounts: derived(s => {
    const counts = {};
    for (const b of s.boards) {
      let n = 0;
      for (const c of b.columns) n += c.cardIds.length;
      counts[b.id] = n;
    }
    return counts;
  }),

  // ---- Board actions ----

  addBoard(name) {
    const id = uid('b');
    this.boards = [
      ...this.boards,
      {
        id,
        name: (name || 'New Board').trim() || 'New Board',
        columns: [
          { id: uid('c'), name: 'To Do',       cardIds: [] },
          { id: uid('c'), name: 'In Progress', cardIds: [] },
          { id: uid('c'), name: 'Done',        cardIds: [] },
        ],
      },
    ];
    this.activeBoardId = id;
    this._save();
    return id;
  },

  removeBoard(id) {
    const board = this.boards.find(b => b.id === id);
    if (!board) return;
    // Drop the board's cards too.
    const nextCards = { ...this.cards };
    for (const col of board.columns) {
      for (const cid of col.cardIds) delete nextCards[cid];
    }
    this.cards = nextCards;
    this.boards = this.boards.filter(b => b.id !== id);
    if (this.activeBoardId === id) {
      this.activeBoardId = this.boards[0]?.id || null;
    }
    this._save();
  },

  renameBoard(id, name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    this.boards = this.boards.map(b => b.id === id ? { ...b, name: trimmed } : b);
    this._save();
  },

  setActiveBoard(id) {
    if (this.boards.some(b => b.id === id)) {
      this.activeBoardId = id;
      this._save();
    }
  },

  // ---- Column actions ----

  addColumn(boardId, name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    this.boards = this.boards.map(b => b.id !== boardId ? b : {
      ...b,
      columns: [...b.columns, { id: uid('c'), name: trimmed, cardIds: [] }],
    });
    this._save();
  },

  removeColumn(boardId, columnId) {
    const board = this.boards.find(b => b.id === boardId);
    if (!board) return;
    const col = board.columns.find(c => c.id === columnId);
    if (!col) return;
    const nextCards = { ...this.cards };
    for (const cid of col.cardIds) delete nextCards[cid];
    this.cards = nextCards;
    this.boards = this.boards.map(b => b.id !== boardId ? b : {
      ...b,
      columns: b.columns.filter(c => c.id !== columnId),
    });
    this._save();
  },

  renameColumn(boardId, columnId, name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    this.boards = this.boards.map(b => b.id !== boardId ? b : {
      ...b,
      columns: b.columns.map(c => c.id === columnId ? { ...c, name: trimmed } : c),
    });
    this._save();
  },

  // ---- Card actions ----

  addCard(boardId, columnId, title) {
    const trimmed = (title || '').trim();
    if (!trimmed) return null;
    const id = uid('card');
    const card = {
      id,
      boardId,
      title: trimmed,
      description: '',
      createdAt: Date.now(),
    };
    this.cards = { ...this.cards, [id]: card };
    this.boards = this.boards.map(b => b.id !== boardId ? b : {
      ...b,
      columns: b.columns.map(c => c.id !== columnId ? c : {
        ...c,
        cardIds: [...c.cardIds, id],
      }),
    });
    this._save();
    return id;
  },

  updateCard(cardId, patch) {
    const card = this.cards[cardId];
    if (!card) return;
    this.cards = { ...this.cards, [cardId]: { ...card, ...patch } };
    this._save();
  },

  removeCard(cardId) {
    const card = this.cards[cardId];
    if (!card) return;
    const nextCards = { ...this.cards };
    delete nextCards[cardId];
    this.cards = nextCards;
    this.boards = this.boards.map(b => b.id !== card.boardId ? b : {
      ...b,
      columns: b.columns.map(c => ({
        ...c,
        cardIds: c.cardIds.filter(id => id !== cardId),
      })),
    });
    this._save();
  },

  // ---- Drag & drop ----
  // Move card from (srcCol, srcIndex) to (dstCol, dstIndex) inside boardId.
  // Indices are computed against the source column's array, then the card
  // is inserted at dstIndex of the destination column.

  moveCard(boardId, cardId, dstColumnId, dstIndex) {
    const board = this.boards.find(b => b.id === boardId);
    if (!board) return;

    // Locate source column
    let srcColumnId = null;
    for (const col of board.columns) {
      if (col.cardIds.includes(cardId)) { srcColumnId = col.id; break; }
    }
    if (!srcColumnId) return;

    // Clamp dstIndex
    const dstCol = board.columns.find(c => c.id === dstColumnId);
    if (!dstCol) return;

    const sameColumn = srcColumnId === dstColumnId;

    this.boards = this.boards.map(b => {
      if (b.id !== boardId) return b;
      // First strip card from source.
      const stripped = b.columns.map(c => c.id !== srcColumnId ? c : {
        ...c,
        cardIds: c.cardIds.filter(id => id !== cardId),
      });
      // Re-locate destination (may share id with source).
      return {
        ...b,
        columns: stripped.map(c => {
          if (c.id !== dstColumnId) return c;
          const arr = [...c.cardIds];
          let idx = dstIndex;
          if (idx < 0) idx = 0;
          if (idx > arr.length) idx = arr.length;
          arr.splice(idx, 0, cardId);
          return { ...c, cardIds: arr };
        }),
      };
    });
    this._save();
    return { srcColumnId, sameColumn };
  },

  // ---- Bulk / debug ----

  resetAll() {
    const fresh = defaultState();
    this.boards = fresh.boards;
    this.cards = fresh.cards;
    this.activeBoardId = fresh.activeBoardId;
    this._save();
  },

  seedDemo(cardsPerColumn = 5) {
    const board = this.boards.find(b => b.id === this.activeBoardId);
    if (!board) return;
    for (const col of board.columns) {
      for (let i = 0; i < cardsPerColumn; i++) {
        this.addCard(board.id, col.id, `${col.name} card ${i + 1}`);
      }
    }
  },

  // ---- Internal ----

  // Coalesced persistence: many actions (drag-drop, bulk seed) fire in rapid
  // succession. We schedule a single localStorage write per microtask burst
  // via a rAF tick — keeps DnD path off the synchronous critical path while
  // still flushing before the user could plausibly close the tab.
  // Coalesced persistence: many actions (drag-drop, bulk seed) fire in rapid
  // succession. We schedule a single localStorage write per microtask burst
  // via a rAF tick — keeps DnD path off the synchronous critical path while
  // still flushing before the user could plausibly close the tab.
  _save() {
    if (typeof localStorage === 'undefined') return;
    if (this._savePending) return;
    this._savePending = true;
    const flush = () => {
      this._savePending = false;
      flushNow(this);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 0);
  },

  flush() {
    this._savePending = false;
    flushNow(this);
  },
});

// Best-effort flush on tab hide / unload. `pagehide` is more reliable than
// `beforeunload` on mobile Safari (which never fires the latter on iOS).
if (typeof window !== 'undefined') {
  const onHide = () => {
    try { useKanban().flush(); } catch {}
  };
  window.addEventListener('pagehide', onHide);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide();
  });
}
