// The shapes of a keyed row callback that the compiler's row analysis
// (babel/lists.js) does not rewrite. A destructured row parameter,
// `({ id, label }) => …`, has its names read off a row item (namedReads), and a
// plain one, `(row) => …`, has its fields read through the row's item cell
// (rowItemReads); each gives up, and leaves the callback as written, when the
// callback binds one of the names again, assigns one, or uses one as a JSX
// tag, and the destructuring when it cannot be read the same way. Such a row
// is handed its item from the row's cell where it is built, `(cell, i) =>
// callback(_$item(cell), i)`, so an item replaced under its key builds the row
// again. Each case checks its compiled form took that way out, then mounts
// the list and drives it through a replaced item, a reorder, an insert and a
// removal against `expect`, the callback run as plain JavaScript.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document, cleanup } = installDOM();
after(cleanup);
const { mount, flushSync } = await import('what-framework');

// [title, callback source, the row's text for an item]
const DESTRUCTURED = [
  ['a field used as a JSX tag', '({ id, Tag, label }) => <li key={id}><Tag text={label} /></li>',
    (r) => `<${r.tagName}>${r.label}`],
  ['a field bound again by an object method', '({ id, label }) => { const o = { f(label) { return label + "!"; } }; return <li key={id}>{o.f(label)}</li>; }',
    (r) => `${r.label}!`],
  ['a field bound again by a function parameter', '({ id, label }) => <li key={id}>{((label) => label + "?")(label)}</li>',
    (r) => `${r.label}?`],
  ['a field bound again by a function name', '({ id, label }) => { const f = function label() { return 1; }; return <li key={id}>{label}{f()}</li>; }',
    (r) => `${r.label}1`],
  ['a field bound again by a class name', '({ id, label }) => { const C = class label { static n = 2; }; return <li key={id}>{label}{C.n}</li>; }',
    (r) => `${r.label}2`],
  ['a field bound again by a declaration', '({ id, label }) => { let out = label; { const label = "inner"; out += label; } return <li key={id}>{out}</li>; }',
    (r) => `${r.label}inner`],
  ['a field bound again by a catch clause', '({ id, label }) => { let caught = ""; try { throw "e"; } catch (label) { caught = label; } return <li key={id}>{label}{caught}</li>; }',
    (r) => `${r.label}e`],
  ['a field assigned', '({ id, label }) => { label = label.toUpperCase(); return <li key={id}>{label}</li>; }',
    (r) => r.label.toUpperCase()],
  ['a field incremented', '({ id, n }) => { n++; return <li key={id}>{n}</li>; }',
    (r) => String(r.n + 1)],
  ['an array pattern', '({ id, pair: [first] }) => <li key={id}>{first}</li>',
    (r) => r.pair[0]],
  ['a computed key that is not a literal', '({ id, [String("label")]: text }) => <li key={id}>{text}</li>',
    (r) => r.label],
  ['a default that is not a literal', '({ id, label = String(id) }) => <li key={id}>{label}</li>',
    (r) => r.label],
  ['a nested rest', '({ id, nested: { ...more } }) => <li key={id}>{more.v}</li>',
    (r) => r.nested.v],
];

const PLAIN = [
  ['the row used as a JSX tag', '(row) => <li key={row.id}><row.Tag text={row.label} /></li>',
    (r) => `<${r.tagName}>${r.label}`],
  ['the row bound again by an object method', '(row) => { const o = { f(row) { return row + "!"; } }; return <li key={row.id}>{o.f(row.label)}</li>; }',
    (r) => `${r.label}!`],
  ['the row bound again by a function parameter', '(row) => <li key={row.id}>{((row) => row + "?")(row.label)}</li>',
    (r) => `${r.label}?`],
  ['the row bound again by a function name', '(row) => { const f = function row() { return 1; }; return <li key={row.id}>{row.label}{f()}</li>; }',
    (r) => `${r.label}1`],
  ['the row bound again by a class name', '(row) => { const C = class row { static n = 2; }; return <li key={row.id}>{row.label}{C.n}</li>; }',
    (r) => `${r.label}2`],
  ['the row bound again by a declaration', '(row) => { let out = row.label; { const row = "inner"; out += row; } return <li key={row.id}>{out}</li>; }',
    (r) => `${r.label}inner`],
  ['the row bound again by a catch clause', '(row) => { let caught = ""; try { throw "e"; } catch (row) { caught = row; } return <li key={row.id}>{row.label}{caught}</li>; }',
    (r) => `${r.label}e`],
  ['the row assigned', '(row) => <li key={row.id}>{(row = { label: row.label + "+" }).label}</li>',
    (r) => `${r.label}+`],
];

// Shapes the analysis goes through and still rewrites: they must keep
// meaning what they meant.
const REWRITTEN = [
  ['a field in shorthand', '({ id, label }) => { const o = { label }; return <li key={id}>{o.label}</li>; }', (r) => r.label, 'destructured'],
  ['a field as a computed key', '({ id, label }) => { const o = { [label]: 1 }; return <li key={id}>{Object.keys(o)[0]}</li>; }', (r) => r.label, 'destructured'],
  ['a field in a class field', '({ id, label }) => { const C = class { v = label; }; return <li key={id}>{new C().v}</li>; }', (r) => r.label, 'destructured'],
  ['a field under a label', '({ id, label }) => { let out = ""; outer: for (const c of [label]) { out += c; break outer; } return <li key={id}>{out}</li>; }', (r) => r.label, 'destructured'],
  ['the row in shorthand', '(row) => { const o = { row }; return <li key={row.id}>{o.row.label}</li>; }', (r) => r.label, 'plain'],
  ['the row as a computed key', '(row) => { const o = { [row.label]: 1 }; return <li key={row.id}>{Object.keys(o)[0]}</li>; }', (r) => r.label, 'plain'],
  ['the row in a class field', '(row) => { const C = class { v = row.label; }; return <li key={row.id}>{new C().v}</li>; }', (r) => r.label, 'plain'],
  ['the row under a label', '(row) => { let out = ""; outer: for (const c of [row.label]) { out += c; break outer; } return <li key={row.id}>{out}</li>; }', (r) => r.label, 'plain'],
];

const TAGS = `
function Em(props) { return <em>{'<em>' + props.text}</em>; }
function Strong(props) { return <strong>{'<strong>' + props.text}</strong>; }
`;
const component = (name, callback) => `export function ${name}(props) { return <ul>{props.rows().map(${callback})}</ul>; }`;

const CASES = [
  ...DESTRUCTURED.map(([title, cb, expect]) => ({ title, cb, expect, kind: 'destructured', unsafe: true })),
  ...PLAIN.map(([title, cb, expect]) => ({ title, cb, expect, kind: 'plain', unsafe: true })),
  ...REWRITTEN.map(([title, cb, expect, kind]) => ({ title, cb, expect, kind, unsafe: false })),
];
const mod = await loadCompiled(`import { signal } from 'what-framework';\n${TAGS}\n${CASES.map((c, i) => component(`C${i}`, c.cb)).join('\n')}\nexport { signal };`);
const { Em, Strong } = await loadCompiled(`${TAGS}\nexport { Em, Strong };`);

// Every field of the replaced item differs from the one it replaces.
const item = (id, label, tag = Em, n = id * 10) => ({
  id, label, n, Tag: tag, tagName: tag === Em ? 'em' : 'strong', pair: [label + '0'], nested: { v: label + n },
});
const replaced = item(2, 'x', Strong, 99);
const STEPS = [
  ['first', [item(1, 'a'), item(2, 'b'), item(3, 'c')]],
  ['an item replaced under its key', [item(1, 'a'), replaced, item(3, 'c')]],
  ['a reorder', [item(3, 'c'), item(1, 'a'), replaced]],
  ['an insert', [item(3, 'c'), item(4, 'd'), item(1, 'a'), replaced]],
  ['a removal', [item(4, 'd'), replaced]],
];

function run(Component, expect) {
  const rows = mod.signal(STEPS[0][1]);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stop = mount(Component({ rows }), host);
  try {
    for (const [step, list] of STEPS) {
      rows(list);
      flushSync();
      const shown = [...host.querySelectorAll('li')].map((li) => li.textContent);
      assert.deepEqual(shown, list.map(expect), step);
    }
  } finally {
    stop();
    host.remove();
  }
}

for (const kind of ['destructured', 'plain']) {
  describe(`a ${kind} row parameter`, () => {
    CASES.forEach((c, i) => {
      if (c.kind !== kind) return;
      it(`${c.unsafe ? 'left as written' : 'rewritten'}: ${c.title}`, () => {
        const out = compileJSX(`${TAGS}\n${component('L', c.cb)}`);
        const handed = /\(_\$item\(_item\$\d+\), _i\$\d+\)/.test(out);
        const rewritten = kind === 'destructured' ? /_row\$/.test(out) : !handed && /_\$item\(_item\$\d+/.test(out);
        assert.equal(handed, c.unsafe, c.unsafe ? 'the row is handed its item where it is built' : 'the row is not wrapped');
        assert.equal(rewritten, !c.unsafe, c.unsafe ? 'the analysis gives up' : 'the analysis rewrites the row');
        assert.match(out, /follow: true/);
        run(mod[`C${i}`], c.expect);
      });
    });
  });
}
