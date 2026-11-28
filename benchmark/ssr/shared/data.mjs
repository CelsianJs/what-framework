// One deterministic dataset for every framework, plus the canonical markup each
// framework's output is checked against before anything is timed.
//
// Words are the js-framework-benchmark lists (benchmark/krausest/frameworks/*),
// but rows come from a seeded PRNG instead of Math.random(), so every process,
// framework and run renders byte-identical row text.

export const ADJECTIVES = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy'];
export const COLOURS = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'];
export const NOUNS = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard'];

// The row that renders with class="danger", so the reactive class binding is
// exercised and its output is asserted.
export const SELECTED_ID = 3;

export const HEADING = 'SSR keyed table';

export const BUTTONS = [
  ['run', 'Create 1,000 rows'],
  ['runlots', 'Create 10,000 rows'],
  ['add', 'Append 1,000 rows'],
  ['update', 'Update every 10th row'],
  ['clear', 'Clear'],
  ['swaprows', 'Swap Rows'],
];

export const FALLBACK_TEXT = 'Loading rows';
export const SHELL_END_TEXT = 'end of page';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildRows(count, seed = 0x5eed) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const rows = new Array(count);
  for (let i = 0; i < count; i++) {
    rows[i] = { id: i + 1, label: `${pick(ADJECTIVES)} ${pick(COLOURS)} ${pick(NOUNS)}` };
  }
  return rows;
}

// Canonical markup of the krausest page (benchmark/krausest/frameworks/*), as
// a framework without hydration markers would print it. An empty class
// attribute is written as absent: verify.mjs treats the two as equal.
export function expectedRowsHtml(rows, selectedId) {
  let out = '';
  for (const row of rows) {
    out += `<tr${row.id === selectedId ? ' class="danger"' : ''}>`
      + `<td class="col-md-1">${row.id}</td>`
      + `<td class="col-md-4"><a class="lbl">${row.label}</a></td>`
      + '<td class="col-md-1"><a class="remove"><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>'
      + '<td class="col-md-6"></td>'
      + '</tr>';
  }
  return out;
}

function expectedShellHtml(tableHtml) {
  const buttons = BUTTONS.map(([id, text]) =>
    `<div class="col-sm-6"><button type="button" class="btn btn-primary" id="${id}">${text}</button></div>`).join('');
  return '<div class="container">'
    + '<div class="jumbotron"><div class="row">'
    + `<div class="col-md-6"><h1>${HEADING}</h1></div>`
    + `<div class="col-md-6"><div class="row">${buttons}</div></div>`
    + '</div></div>'
    + tableHtml
    + '</div>';
}

export function expectedPageHtml(rows, selectedId) {
  return expectedShellHtml(
    `<table class="table table-hover table-striped test-data"><tbody>${expectedRowsHtml(rows, selectedId)}</tbody></table>`,
  );
}

// The component page: CARD_COUNT small components, each a card with fixed
// text, text from its props and a counter of its own (a signal shown in a
// button), so server rendering and hydration pay for components rather than
// for one big list's rows.
export const CARD_COUNT = 200;

export function buildCards(count, seed = 0xca7d) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const cards = new Array(count);
  for (let i = 0; i < count; i++) {
    cards[i] = { id: i + 1, title: `${pick(ADJECTIVES)} ${pick(COLOURS)} ${pick(NOUNS)}`, start: Math.floor(rand() * 10) };
  }
  return cards;
}

export function expectedCardsHtml(cards) {
  let out = '<div class="cards">';
  for (const card of cards) {
    out += `<div class="card" id="card-${card.id}">`
      + `<h3 class="title">${card.title}</h3>`
      + `<p class="note">Card ${card.id} of ${cards.length}</p>`
      + `<button type="button" class="inc">${card.start}</button>`
      + '</div>';
  }
  return out + '</div>';
}
