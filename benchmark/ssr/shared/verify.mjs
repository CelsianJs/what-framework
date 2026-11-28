// Output-equivalence checks, run on every framework and bundle before timing,
// so no framework wins by rendering less.
//
// normalize() removes only what a framework adds for its own hydration:
//   - HTML comments (What <!--$-->/<!--[]-->, Solid <!--$-->/<!--!$-->, React
//     <!-- --> text separators and <!--$--> boundaries)
//   - hydration-key attributes (data-hk, Solid 2's _hk)
//   - <script> and <template> elements (streamed swap payloads)
//   - empty class attributes (class="" and no class are the same document)
// It then re-serializes every tag with its attributes sorted, so attribute
// order cannot cause a mismatch. Text, tags and attribute values must match
// the canonical markup from data.mjs exactly.

const HYDRATION_ATTRS = new Set(['data-hk', '_hk']);
// Attribute values may be double-quoted or bare (Solid 2 prints _hk=0).
const ATTR_RE = /\s+([^\s=>/]+)(?:=(?:"([^"]*)"|([^\s"'>]+)))?/g;
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:=(?:"[^"]*"|[^\s"'>]+))?)*)\s*(\/?)>/g;

function canonicalTag(close, name, attrs, selfClose) {
  if (close) return `</${name}>`;
  const list = [];
  for (const [, key, quoted, bare] of attrs.matchAll(ATTR_RE)) {
    const value = quoted ?? bare ?? '';
    if (HYDRATION_ATTRS.has(key)) continue;
    if (key === 'class' && value === '') continue;
    list.push(value === '' && key !== 'class' ? `${key}=""` : `${key}="${value}"`);
  }
  list.sort();
  return `<${name}${list.length ? ' ' + list.join(' ') : ''}>${selfClose ? `</${name}>` : ''}`;
}

export function normalize(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/g, '')
    .replace(/<template\b[\s\S]*?<\/template>/g, '')
    .replace(TAG_RE, (_, close, name, attrs, selfClose) => canonicalTag(close, name.toLowerCase(), attrs, selfClose));
}

function rowCount(html) {
  return (html.match(/<tr[\s>]/g) || []).length;
}

function cellText(html, rowId) {
  const m = html.match(new RegExp(`<td class="col-md-1">${rowId}</td><td class="col-md-4"><a class="lbl">([^<]*)</a>`));
  return m ? m[1] : null;
}

// Throws with a precise message on the first mismatch.
export function verifyPage(html, rows, selectedId, expected) {
  const n = normalize(html);
  const count = rowCount(n);
  if (count !== rows.length) throw new Error(`expected ${rows.length} rows, got ${count}`);
  for (const row of [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]]) {
    const text = cellText(n, row.id);
    if (text !== row.label) throw new Error(`row ${row.id}: expected label ${JSON.stringify(row.label)}, got ${JSON.stringify(text)}`);
  }
  const danger = n.match(/<tr class="danger"><td class="col-md-1">(\d+)<\/td>/g) || [];
  if (danger.length !== 1 || !danger[0].includes(`>${selectedId}<`)) {
    throw new Error(`expected exactly row ${selectedId} to have class="danger", found ${danger.length}`);
  }
  const canonical = normalize(expected);
  if (n !== canonical) {
    let i = 0;
    while (i < n.length && n[i] === canonical[i]) i++;
    throw new Error(`structure differs at offset ${i}:\n  got      ${JSON.stringify(n.slice(Math.max(0, i - 60), i + 80))}\n  expected ${JSON.stringify(canonical.slice(Math.max(0, i - 60), i + 80))}`);
  }
}

// Streamed async page: the shell, the fallback-or-content, and every row must
// be in the final output. Out-of-order streamers (Solid, React) place the
// resolved table in a swap payload after the shell, so full structural
// equality is not expected here; rows and cell text are checked inside the
// payload instead.
export function verifyAsyncPage(html, rows, selectedId, shellEndText) {
  if (!html.includes(shellEndText)) throw new Error('shell end marker missing');
  const withPayload = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?template\b[^>]*>/g, '');
  const n = normalize(withPayload.replace(/<script\b[\s\S]*?<\/script>/g, ''));
  const count = rowCount(n);
  if (count !== rows.length) throw new Error(`expected ${rows.length} rows, got ${count}`);
  for (const row of [rows[0], rows[rows.length - 1]]) {
    const text = cellText(n, row.id);
    if (text !== row.label) throw new Error(`row ${row.id}: expected label ${JSON.stringify(row.label)}, got ${JSON.stringify(text)}`);
  }
  if (!new RegExp(`<tr class="danger"><td class="col-md-1">${selectedId}</td>`).test(n)) {
    throw new Error(`row ${selectedId} is not marked selected`);
  }
}

// The component page (data.mjs expectedCardsHtml): every card, the text of
// three of them, and structural equality after normalize().
export function verifyCards(html, cards, expected) {
  const n = normalize(html);
  const count = (n.match(/<div class="card" id="card-\d+">/g) || []).length;
  if (count !== cards.length) throw new Error(`expected ${cards.length} cards, got ${count}`);
  for (const card of [cards[0], cards[Math.floor(cards.length / 2)], cards[cards.length - 1]]) {
    const m = n.match(new RegExp(`<div class="card" id="card-${card.id}"><h3 class="title">([^<]*)</h3>`));
    if (!m || m[1] !== card.title) throw new Error(`card ${card.id}: expected title ${JSON.stringify(card.title)}, got ${JSON.stringify(m && m[1])}`);
  }
  const canonical = normalize(expected);
  if (n !== canonical) {
    let i = 0;
    while (i < n.length && n[i] === canonical[i]) i++;
    throw new Error(`structure differs at offset ${i}:\n  got      ${JSON.stringify(n.slice(Math.max(0, i - 60), i + 80))}\n  expected ${JSON.stringify(canonical.slice(Math.max(0, i - 60), i + 80))}`);
  }
}
