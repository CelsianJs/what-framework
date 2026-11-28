// The board's state: the columns' card order as one signal, replaced on
// every move (only the columns a move changes are new objects), and the
// moves made, for undo and redo.

import { batch, signal } from 'what-framework';

import { COLUMNS, makeBoard, makeCards, move } from './data.js';

export const cards = makeCards();
export const board = signal(makeBoard(), 'board');
export const columnIndex = Object.fromEntries(COLUMNS.map((c, i) => [c.id, i]));

const past = [];
const future = [];
export const history = signal({ undo: 0, redo: 0 }, 'history');
const sync = () => history({ undo: past.length, redo: future.length });

export function moveCard(from, to) {
  if (from.col === to.col && from.index === to.index) return;
  batch(() => {
    board((b) => move(b, from, to));
    past.push({ from, to });
    future.length = 0;
    sync();
  });
}

export function undo() {
  const m = past.pop();
  if (!m) return;
  batch(() => {
    board((b) => move(b, m.to, m.from));
    future.push(m);
    sync();
  });
}

export function redo() {
  const m = future.pop();
  if (!m) return;
  batch(() => {
    board((b) => move(b, m.from, m.to));
    past.push(m);
    sync();
  });
}

// Cards built and disposed, for the smoke check: a move within a column
// builds nothing, a move between columns builds one card and disposes one.
export const probes = { created: 0, disposed: 0 };
if (typeof window !== 'undefined') window.__board = { probes, board };
