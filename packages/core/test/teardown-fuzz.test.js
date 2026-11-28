// Seeded fuzz of compiled trees under many writes, against three oracles.
//
// Each case is a random compiled tree: keyed lists (`.map()` with a key),
// keyed and unkeyed `<For>`, `.map()` without a key, h() keyed lists, branches,
// fragments, components returning fragments, arrays, text or thunks, and lists
// nested two deep. Elements carry attribute bindings (title, class, data-*),
// and some components create effects, useEffects and cleanups in their bodies
// and bind attributes on their root, anywhere a component can go: in branches
// and list rows included. Lists read arrays of unique keys and arrays whose
// values repeat, so keyed lists meet duplicate keys and unkeyed lists repeated
// items. After every random write the live tree must equal a fresh render of
// the same state in DOM and in live subscriber counts, and a row whose unique
// key persisted in a list that persisted must still be the same element. After
// unmount no signal may have a subscriber, no thunk or effect may run, and
// every component that was built has been cleaned up.
//
// Every case is reproducible from its index: the failure message carries the
// seed, the case, the JSX and the writes. The run is bounded by time; set
// WHAT_FUZZ_MS, WHAT_FUZZ_SEED or WHAT_FUZZ_CASE to explore further.
//
// Adapted from the w1 review's teardown-fuzz.mjs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { signal, flushSync, mount } = await import('what-framework');
const { __subsOf } = await import('../src/reactive.js');
const { capture } = await import('../src/diagnostics.js');

const SEED = Number(process.env.WHAT_FUZZ_SEED ?? 1);
const BUDGET_MS = Number(process.env.WHAT_FUZZ_MS ?? 6000);
const ONLY = process.env.WHAT_FUZZ_CASE != null ? Number(process.env.WHAT_FUZZ_CASE) : null;
const MIN_CASES = 60;
const MAX_CASES = 400;
const STEPS = 12;

function gen(seed) {
  let s = seed >>> 0;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  return { rnd, int: (n) => Math.floor(rnd() * n), pick: (a) => a[Math.floor(rnd() * a.length)] };
}

// ---- JSX generator ----
// The scope `S` holds the signals: s0 s1 (strings), b0 b1 (booleans), L0 L1
// (arrays of unique keys), D0 (an array whose values repeat), sel.
let listDepth = 0;
let listCount = 0;

function listSource(g) {
  return g.pick(['L0', 'L1', 'D0']);
}

// A list row element carries its list and its key, which the identity oracle
// reads. Only top-level lists are tracked (data-d="1").
function rowAttrs(v) {
  return ` data-l="${listCount++}" data-d="${listDepth}" data-k={String(${v})}`;
}

function child(g, depth, rowVar) {
  const kinds = depth <= 0 ? ['text', 'read', 'thunk', 'rowv'] :
    ['text', 'read', 'thunk', 'el', 'el', 'cond', 'and', 'frag', 'comp', 'list', 'for', 'rowv', 'cond', 'hlist', 'plainmap'];
  let k = g.pick(kinds);
  if (k === 'rowv' && !rowVar) k = 'read';
  if ((k === 'list' || k === 'for' || k === 'hlist' || k === 'plainmap') && listDepth >= 2) k = 'el';
  switch (k) {
    case 'text': return g.pick(['A', 'b c', ' ', 'D']);
    case 'read': return `{S.s${g.int(2)}()}`;
    case 'thunk': return `{() => (T.n++, S.s${g.int(2)}())}`;
    case 'rowv': return `{${rowVar}}`;
    case 'el': return el(g, depth - 1, rowVar);
    case 'cond': return `{S.b${g.int(2)}() ? ${el(g, depth - 1, rowVar)} : ${g.rnd() < 0.5 ? 'null' : el(g, depth - 1, rowVar)}}`;
    case 'and': return `{S.b${g.int(2)}() && ${el(g, depth - 1, rowVar)}}`;
    case 'frag': return `<>${kids(g, depth - 1, rowVar)}</>`;
    case 'comp': { const c = g.int(9); return `<C${c} S={S}>${kids(g, depth - 1, rowVar)}</C${c}>`; }
    case 'list': {
      listDepth++;
      const v = `k${listDepth}`;
      const L = `S.${listSource(g)}`;
      let row;
      const sel = g.rnd() < 0.5 ? ` class={S.sel() === ${v} ? 'on' : 'off'}` : '';
      if (g.int(4) === 3) {
        const c = g.int(9);
        row = `<C${c} key={${v}} S={S}>{${v}}${kids(g, depth - 1, v)}</C${c}>`;
      } else {
        const tag = g.pick(['li', 'span', 'div']);
        row = `<${tag} key={${v}}${rowAttrs(v)}${sel}>{${v}}${kids(g, depth - 1, v)}</${tag}>`;
      }
      listDepth--;
      return `{${L}().map(${v} => ${row})}`;
    }
    case 'plainmap': {
      listDepth++;
      const v = `p${listDepth}`;
      const row = `<i>{${v}}${kids(g, depth - 1, v)}</i>`;
      listDepth--;
      return `{S.${listSource(g)}().map(${v} => ${row})}`;
    }
    case 'for': {
      listDepth++;
      const v = `f${listDepth}`;
      const keyed = g.rnd() < 0.5;
      const body = g.rnd() < 0.5
        ? `<b${rowAttrs(v)}>{${v}}${kids(g, depth - 1, v)}</b>`
        : `<>{${v}}${kids(g, depth - 1, v)}</>`;
      listDepth--;
      // Keyed <For> passes an accessor: unwrap it so rows read the same either way.
      return keyed
        ? `<For each={S.${listSource(g)}} key={x => x}>{(${v}a) => { const ${v} = ${v}a(); return ${body}; }}</For>`
        : `<For each={S.${listSource(g)}}>{(${v}) => ${body}}</For>`;
    }
    case 'hlist': return `<H${g.int(2)} S={S} L="${listSource(g)}" lid="${listDepth === 0 ? listCount++ : 'nested'}" />`;
  }
  return '';
}
function kids(g, depth, rowVar) {
  let out = '';
  for (let i = g.int(4); i > 0; i--) out += child(g, depth, rowVar);
  return out;
}
function el(g, depth, rowVar) {
  const tag = g.pick(['div', 'span', 'section', 'em']);
  let attr = '';
  if (g.rnd() < 0.3) attr += ` title={S.s${g.int(2)}()}`;
  if (g.rnd() < 0.2) attr += ` class={S.b${g.int(2)}() ? 'on' : 'off'}`;
  if (g.rnd() < 0.2) attr += ` data-x={T.r(S.s${g.int(2)}())}`;
  return `<${tag}${attr}>${kids(g, depth, rowVar)}</${tag}>`;
}

// H0 and H1 render an h() keyed list: rows of one element, and rows of a
// component returning two siblings.
// C6 to C8 create effects, useEffects and cleanups in their bodies and bind
// attributes on their root; T.live counts the ones built and not cleaned up.
const PRELUDE = `
import { For, h, effect, useEffect, onCleanup } from 'what-framework';
// T.r(v) is v, counted: an attribute binding that runs after unmount shows.
export const T = { n: 0, live: 0, r: (v) => (T.n++, v) };
function C0(p) { return <>{p.children}<i>c0</i></>; }
function C1(p) { return [<u>c1</u>, p.children]; }
function C2(p) { return null; }
function C3(p) { return () => (T.n++, p.S.s0() + '!'); }
function C4(p) { return 'c4'; }
function C5(p) { return <q>{() => (T.n++, p.S.s1())}{p.children}</q>; }
function C6(p) {
  T.live++;
  onCleanup(() => { T.live--; });
  effect(() => { T.n++; p.S.s0(); });
  return <s class={p.S.b0() ? 'on' : 'off'} data-v={T.r(p.S.s1())}>{p.children}</s>;
}
function C7(p) {
  T.live++;
  useEffect(() => { T.n++; p.S.b1(); return () => { T.n++; }; });
  onCleanup(() => { T.live--; });
  return <>{p.children}<small title={p.S.s0()}>c7</small></>;
}
function C8(p) {
  T.live++;
  effect(() => { if (p.S.b0()) effect(() => { T.n++; p.S.s1(); }); return () => { T.n++; }; });
  onCleanup(() => { T.live--; });
  return [<sub data-b={String(p.S.b1())}>c8</sub>, p.children];
}
const rowOf = (p, k) => ({ 'data-l': p.lid, 'data-d': p.lid === 'nested' ? '2' : '1', 'data-k': String(k) });
function Pair(p) { return [h('dt', rowOf(p, p.k), String(p.k)), h('dd', {}, () => (T.n++, p.S.s0()))]; }
function H0(p) { return h('ol', {}, () => p.S[p.L]().map(k => h('li', { key: k, ...rowOf(p, k) }, String(k), () => (T.n++, p.S.s1())))); }
function H1(p) { return h('dl', {}, () => p.S[p.L]().map(k => h(Pair, { key: k, k, lid: p.lid, S: p.S }))); }
`;

// ---- values ----
const KEYS = ['a', 'b', 'c', 'd', 'e', 1, 2];
function nextValue(g, name, cur) {
  if (name[0] === 's') return g.pick(['x', 'y', 'zz', '']);
  if (name[0] === 'b') return !cur;
  if (name === 'sel') return g.pick(KEYS);
  const repeats = name === 'D0';
  const next = cur.slice();
  const free = () => (repeats ? KEYS : KEYS.filter((k) => !next.includes(k)));
  switch (g.int(8)) {
    case 0: { const f = free(); if (f.length) next.splice(g.int(next.length + 1), 0, g.pick(f)); break; }
    case 1: if (next.length) next.splice(g.int(next.length), 1); break;
    case 2: if (next.length > 1) { const a = g.int(next.length), b = g.int(next.length); [next[a], next[b]] = [next[b], next[a]]; } break;
    case 3: next.reverse(); break;
    case 4: return [];
    case 5: {
      if (repeats) return Array.from({ length: g.int(7) }, () => g.pick(['a', 'b', 'c', 1]));
      const f = KEYS.slice().sort(() => g.rnd() - 0.5);
      return f.slice(0, g.int(6));
    }
    case 6: for (let i = next.length - 1; i > 0; i--) { const j = g.int(i + 1); [next[i], next[j]] = [next[j], next[i]]; } break;
    case 7: if (repeats && next.length) next.splice(g.int(next.length + 1), 0, next[g.int(next.length)]); break;
  }
  return next;
}
const NAMES = ['s0', 's1', 'b0', 'b1', 'L0', 'L1', 'D0', 'sel'];
const LISTS = new Set(['L0', 'L1', 'D0']);
const INIT = { s0: 'x', s1: 'y', b0: true, b1: false, L0: ['a', 'b', 'c'], L1: [1, 'd'], D0: ['a', 'a', 'b'], sel: 'b' };
const makeSignals = (vals) => Object.fromEntries(NAMES.map((n) => [n, signal(Array.isArray(vals[n]) ? vals[n].slice() : vals[n])]));
const subsCount = (S) => Object.fromEntries(NAMES.map((n) => [n, __subsOf(S[n]).length]));
const ser = (node) => node.innerHTML.replace(/<!--[^]*?-->/g, '');

// Top-level list rows by "list:key", for keys that appear once in their list.
function trackedRows(box, vals, sourceOf) {
  const rows = new Map();
  for (const row of box.querySelectorAll('[data-d="1"]')) {
    const list = row.getAttribute('data-l');
    const key = row.getAttribute('data-k');
    const source = vals[sourceOf.get(list)];
    if (!source || source.filter((k) => String(k) === key).length !== 1) continue;
    rows.set(`${list}:${key}`, row);
  }
  return rows;
}

function sourcesOf(jsx) {
  // A list's id is emitted right after its source is picked, so the nearest
  // preceding `S.X()`, `each={S.X}` or `L="X"` names it.
  const out = new Map();
  const re = /S\.(L0|L1|D0)\b|L="(L0|L1|D0)"|(?:data-l|lid)="(\d+)"/g;
  let last = null;
  for (let m; (m = re.exec(jsx));) {
    if (m[3] === undefined) last = m[1] || m[2];
    else out.set(m[3], last);
  }
  return out;
}

async function runCase(c) {
  const g = gen(SEED * 7919 + c);
  listDepth = 0;
  listCount = 0;
  const jsx = `<main>${kids(g, 3, null) || 'E'}${child(g, 3, null)}</main>`;
  // The compiler's own advice (a key for .map(), .map() over <For>) is not
  // what this run is about.
  const { warn, info } = console;
  console.warn = console.info = () => {};
  let mod;
  try {
    mod = await loadCompiled(PRELUDE + `export const build = (S) => ${jsx};`);
  } finally {
    console.warn = warn;
    console.info = info;
  }
  const sourceOf = sourcesOf(jsx);
  const vals = JSON.parse(JSON.stringify(INIT));
  const S = makeSignals(vals);
  const box = document.body.appendChild(document.createElement('div'));
  const log = [];
  const where = () => `seed ${SEED} case ${c}\n${jsx}\nwrites: ${log.join(', ')}`;
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' ').slice(0, 300));
  let unmount = null;
  try {
    unmount = mount(() => mod.build(S), box);
    flushSync();
    for (let step = 0; step <= STEPS; step++) {
      let before = null;
      if (step > 0) {
        const name = g.pick(NAMES);
        // Branches stay put on a write to anything but b0/b1, so every
        // top-level list persists and so must its uniquely keyed rows.
        if (name[0] !== 'b') before = trackedRows(box, vals, sourceOf);
        vals[name] = nextValue(g, name, vals[name]);
        log.push(`${name}=${JSON.stringify(vals[name])}`);
        S[name](Array.isArray(vals[name]) ? vals[name].slice() : vals[name]);
        flushSync();
      }
      const F = makeSignals(vals);
      const fresh = document.body.appendChild(document.createElement('div'));
      const stopFresh = mount(() => mod.build(F), fresh);
      flushSync();
      const actual = ser(box);
      const expected = ser(fresh);
      const live = subsCount(S);
      const freshSubs = subsCount(F);
      stopFresh();
      fresh.remove();
      assert.equal(actual, expected, `DOM differs from a fresh render at step ${step}\n${where()}`);
      assert.deepEqual(live, freshSubs, `live subscribers differ from a fresh render at step ${step}\n${where()}`);
      if (before !== null) {
        const after = trackedRows(box, vals, sourceOf);
        for (const [id, row] of before) {
          if (after.has(id)) assert.equal(after.get(id), row, `row ${id} was rebuilt although its key persisted\n${where()}`);
        }
      }
    }
    unmount();
    unmount = null;
    assert.equal(mod.T.live, 0, `components left without their cleanup after unmount\n${where()}`);
    const runs = mod.T.n;
    for (const n of NAMES) S[n](LISTS.has(n) ? ['e', 2] : nextValue(g, n, vals[n]));
    flushSync();
    const left = Object.fromEntries(Object.entries(subsCount(S)).filter(([, v]) => v));
    assert.deepEqual(left, {}, `signals keep subscribers after unmount\n${where()}`);
    assert.equal(mod.T.n, runs, `thunks or effects ran after unmount\n${where()}`);
    assert.deepEqual(errors, [], `console.error during the case\n${where()}`);
  } finally {
    console.error = originalError;
    if (unmount) unmount();
    box.remove();
  }
}

describe('teardown fuzz: compiled trees under random writes', () => {
  it(`matches a fresh render, keeps keyed rows and leaks nothing (seed ${SEED})`, async (t) => {
    const diagnostics = capture({ quiet: true });
    const started = Date.now();
    let cases = 0;
    try {
      if (ONLY !== null) {
        await runCase(ONLY);
        cases = 1;
      } else {
        while (cases < MAX_CASES && (cases < MIN_CASES || Date.now() - started < BUDGET_MS)) {
          await runCase(cases);
          cases++;
        }
      }
    } finally {
      diagnostics.stop();
    }
    t.diagnostic(`${cases} cases of ${STEPS} writes in ${Date.now() - started} ms`);
    assert.ok(cases >= (ONLY !== null ? 1 : MIN_CASES));
    const codes = new Set(diagnostics.events.map((e) => e.code));
    if (ONLY === null) assert.ok(codes.has('ERR_DUPLICATE_KEY'), 'the run met duplicate keys');
  });
});
