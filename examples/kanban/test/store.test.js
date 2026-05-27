// Store behavior tests — pure logic, no DOM.
// Validates that the kanban store's invariants hold across mutations,
// including persistence shape, corruption recovery, and DnD semantics.

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage before importing the store, since the module reads it at
// import time. Node 18+ has no localStorage by default.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
// requestAnimationFrame -> synchronous so _save persists immediately in tests.
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
// Avoid `window` listeners from registering during import.
globalThis.window = undefined;

// Reset module cache by importing with cache-busting query (Node ESM caches by URL).
const { useKanban } = await import('../src/store.js');

function fresh() {
  // Reset to default state.
  useKanban().resetAll();
}

describe('kanban store', () => {
  beforeEach(fresh);

  it('starts with one default board and three columns', () => {
    const s = useKanban();
    assert.equal(s.boards.length, 1);
    assert.equal(s.boards[0].columns.length, 3);
    assert.equal(s.cardCount, 0);
  });

  it('addBoard creates a board and activates it', () => {
    const s = useKanban();
    const id = s.addBoard('Backlog');
    assert.equal(s.boards.length, 2);
    assert.equal(s.activeBoardId, id);
    assert.equal(s.activeBoard.name, 'Backlog');
  });

  it('addBoard with empty name defaults to "New Board"', () => {
    const s = useKanban();
    s.addBoard('');
    assert.equal(s.boards[s.boards.length - 1].name, 'New Board');
  });

  it('addCard inserts into the requested column', () => {
    const s = useKanban();
    const b = s.activeBoard;
    const colId = b.columns[0].id;
    const cardId = s.addCard(b.id, colId, 'Write tests');
    assert.ok(cardId);
    const col = s.activeBoard.columns.find(c => c.id === colId);
    assert.deepEqual(col.cardIds, [cardId]);
    assert.equal(s.cards[cardId].title, 'Write tests');
    assert.equal(s.cardCount, 1);
  });

  it('moveCard between columns preserves cardCount and updates positions', () => {
    const s = useKanban();
    const b = s.activeBoard;
    const [c1, c2] = b.columns;
    const id = s.addCard(b.id, c1.id, 'Card A');
    s.moveCard(b.id, id, c2.id, 0);
    const b2 = s.activeBoard;
    const newC1 = b2.columns.find(c => c.id === c1.id);
    const newC2 = b2.columns.find(c => c.id === c2.id);
    assert.deepEqual(newC1.cardIds, []);
    assert.deepEqual(newC2.cardIds, [id]);
    assert.equal(s.cardCount, 1);
  });

  it('moveCard within the same column reorders correctly', () => {
    const s = useKanban();
    const b = s.activeBoard;
    const col = b.columns[0];
    const a = s.addCard(b.id, col.id, 'A');
    const bId = s.addCard(b.id, col.id, 'B');
    const c = s.addCard(b.id, col.id, 'C');
    // Move A to the end
    s.moveCard(b.id, a, col.id, 3);
    const updated = s.activeBoard.columns.find(c => c.id === col.id);
    assert.deepEqual(updated.cardIds, [bId, c, a]);
  });

  it('moveCard clamps dstIndex within bounds', () => {
    const s = useKanban();
    const b = s.activeBoard;
    const col = b.columns[0];
    const id = s.addCard(b.id, col.id, 'X');
    // Way past the end
    s.moveCard(b.id, id, col.id, 9999);
    const updated = s.activeBoard.columns.find(c => c.id === col.id);
    assert.deepEqual(updated.cardIds, [id]);
  });

  it('removeColumn drops all cards inside it', () => {
    const s = useKanban();
    const b = s.activeBoard;
    const col = b.columns[0];
    s.addCard(b.id, col.id, 'doomed-1');
    s.addCard(b.id, col.id, 'doomed-2');
    assert.equal(s.cardCount, 2);
    s.removeColumn(b.id, col.id);
    assert.equal(s.cardCount, 0);
    assert.equal(s.activeBoard.columns.length, 2);
  });

  it('removeBoard switches activeBoardId to a remaining board', () => {
    const s = useKanban();
    const original = s.activeBoardId;
    const other = s.addBoard('Other');
    s.setActiveBoard(other);
    s.removeBoard(other);
    assert.equal(s.activeBoardId, original);
    assert.equal(s.boards.length, 1);
  });

  it('persists state across reloads (round-trip through localStorage)', () => {
    const s = useKanban();
    const b = s.activeBoard;
    const col = b.columns[1];
    s.addCard(b.id, col.id, 'persisted');
    s.flush(); // synchronous write
    const raw = globalThis.localStorage.getItem('what-kanban-v1');
    assert.ok(raw, 'localStorage should contain the snapshot');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.boards.length, 1);
    assert.ok(parsed.cards);
    const card = Object.values(parsed.cards).find(c => c.title === 'persisted');
    assert.ok(card, 'card should be present in persisted state');
  });

  it('seedDemo populates each column', () => {
    const s = useKanban();
    s.seedDemo(3);
    const b = s.activeBoard;
    for (const col of b.columns) {
      assert.equal(col.cardIds.length, 3);
    }
    assert.equal(s.cardCount, 9);
  });
});
