// A deterministic release board: five columns, 1,000 cards.
//
// Seeded, so every run and the smoke check see the same board: the check
// imports this module, applies the same moves to its own copy, and compares
// the page with it. `move` is the one operation the board has, used by the
// page and by the check alike.

export const COLUMNS = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'next', title: 'Next' },
  { id: 'doing', title: 'Doing' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
];
export const CARDS_PER_COLUMN = 200;

const VERBS = ['Fix', 'Ship', 'Audit', 'Port', 'Trim', 'Cache', 'Index', 'Retry', 'Split', 'Guard'];
const NOUNS = ['router', 'hydration', 'tooltip', 'billing', 'search', 'upload', 'session', 'export', 'sidebar', 'webhook', 'locale', 'pager'];
const TAGS = ['bug', 'feature', 'chore', 'perf', 'docs'];

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCards() {
  const rand = mulberry32(7);
  const cards = {};
  let n = 0;
  for (let c = 0; c < COLUMNS.length; c++) {
    for (let i = 0; i < CARDS_PER_COLUMN; i++) {
      const id = `T-${1000 + n++}`;
      cards[id] = {
        id,
        title: `${VERBS[Math.floor(rand() * VERBS.length)]} ${NOUNS[Math.floor(rand() * NOUNS.length)]}`,
        tag: TAGS[Math.floor(rand() * TAGS.length)],
        points: 1 + Math.floor(rand() * 8),
      };
    }
  }
  return cards;
}

/** The columns with their card ids, in order. */
export function makeBoard() {
  let n = 0;
  return COLUMNS.map((col) => ({ ...col, cards: Array.from({ length: CARDS_PER_COLUMN }, () => `T-${1000 + n++}`) }));
}

/**
 * The board after moving the card at `from` ({ col, index }) to `to` ({ col,
 * index }, the index it has once it is there). Returns a new board; only the
 * columns it changes are new objects.
 */
export function move(board, from, to) {
  const next = board.slice();
  const source = { ...next[from.col], cards: next[from.col].cards.slice() };
  const [id] = source.cards.splice(from.index, 1);
  next[from.col] = source;
  const target = to.col === from.col ? source : { ...next[to.col], cards: next[to.col].cards.slice() };
  target.cards.splice(to.index, 0, id);
  next[to.col] = target;
  return next;
}
