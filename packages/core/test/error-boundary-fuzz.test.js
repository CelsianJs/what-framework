// Seeded fuzz of <ErrorBoundary> on the owner tree, against a model.
//
// Each case is a random tree of plain elements, always-on reactive regions,
// one-row keyed lists and boundaries at random depths, with leaf components
// that fail in one of five ways once their `fail` signal is set:
//
//   effect   an effect whose re-run throws
//   binding  a reactive text binding whose re-run throws
//   cleanup  an effect whose cleanup throws before its re-run
//   row      a list row's effect re-run throws, and a row the list creates on
//            that same re-run throws while it is built
//   later    a region builds a component whose body throws
//
// Some boundaries have a fallback that throws, which goes to the boundary
// above. Random steps set a mounted leaf's `fail`, or reset a boundary that is
// showing its fallback (clearing the failures under it first). After every
// step the model says which boundaries show their fallback and which leaves
// are alive, and the page must agree: the fallback markers in the DOM, and the
// leaves whose heartbeat effect answers a write, once each, and no other. An
// error with no boundary above it is logged and changes nothing else. After
// unmount nothing answers.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { signal, effect, batch, flushSync, untrack, mount, h, ErrorBoundary } = await import('../src/index.js');
const { __subsOf } = await import('../src/reactive.js');
const { __DEV__ } = await import('../src/env.js');

const SEED = Number(process.env.WHAT_FUZZ_SEED ?? 1);
const CASES = Number(process.env.WHAT_FUZZ_CASES ?? 250);
const STEPS = 14;
const KINDS = ['effect', 'binding', 'cleanup', 'row', 'later'];

function gen(seed) {
  let s = seed >>> 0;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  return { rnd, int: (n) => Math.floor(rnd() * n), pick: (a) => a[Math.floor(rnd() * a.length)] };
}

// The tree as data: { type: 'leaf', id, kind } | { type: 'boundary', id,
// badFallback, children } | { type: 'div' | 'region' | 'list', children }.
function makeTree(g) {
  let leaves = 0;
  let boundaries = 0;
  const node = (depth) => {
    if (depth === 0 || g.rnd() < 0.3) return { type: 'leaf', id: leaves++, kind: g.pick(KINDS) };
    const type = g.pick(['boundary', 'boundary', 'div', 'region', 'list']);
    const children = Array.from({ length: 1 + g.int(3) }, () => node(depth - 1));
    if (type === 'boundary') return { type, id: boundaries++, badFallback: g.rnd() < 0.15, children };
    return { type, children };
  };
  const root = { type: 'div', children: Array.from({ length: 1 + g.int(3) }, () => node(3)) };
  return { root, leaves, boundaries };
}

// The leaves and boundaries of a subtree, and each node's nearest boundary.
function index(tree) {
  const leafOwner = new Map();
  const boundaryParent = new Map();
  const under = new Map();
  const walk = (n, boundary) => {
    if (n.type === 'leaf') {
      leafOwner.set(n.id, boundary);
      for (let b = boundary; b !== null; b = boundaryParent.get(b)) under.get(b).leaves.push(n.id);
      return;
    }
    let inner = boundary;
    if (n.type === 'boundary') {
      boundaryParent.set(n.id, boundary);
      under.set(n.id, { leaves: [], boundaries: [] });
      for (let b = boundary; b !== null; b = boundaryParent.get(b)) under.get(b).boundaries.push(n.id);
      inner = n.id;
    }
    for (const c of n.children) walk(c, inner);
  };
  walk(tree.root, null);
  return { leafOwner, boundaryParent, under };
}

async function runCase(c) {
  const g = gen(SEED * 7919 + c);
  const tree = makeTree(g);
  const { leafOwner, boundaryParent, under } = index(tree);
  const beat = signal(0);
  const fail = Array.from({ length: tree.leaves }, () => signal(false));
  const rows = Array.from({ length: tree.leaves }, () => signal(['a']));
  const beats = new Array(tree.leaves).fill(0);
  const resets = new Map();
  const badFallback = new Map();

  function Leaf({ id, kind }) {
    effect(() => { beat(); beats[id]++; });
    const f = fail[id];
    const fails = () => new Error(`leaf ${id} (${kind})`);
    switch (kind) {
      case 'effect':
        effect(() => { if (f()) throw fails(); });
        return h('i', {}, `L${id}`);
      case 'binding':
        return h('i', {}, () => { if (f()) throw fails(); return `L${id}`; });
      case 'cleanup':
        effect(() => { const was = f(); return () => { if (!was && untrack(f)) throw fails(); }; });
        return h('i', {}, `L${id}`);
      case 'row': {
        function Row() {
          effect(() => { if (f()) throw fails(); });
          return h('u', {}, 'r');
        }
        return h('i', {}, `L${id}`, h('ul', {}, () => rows[id]().map((k) => h(Row, { key: k }))));
      }
      default: {
        function Thrower() { throw fails(); }
        return h('i', {}, `L${id}`, () => (f() ? h(Thrower, {}) : 'ok'));
      }
    }
  }
  function Pass({ children }) { return children; }

  const build = (n) => {
    if (n.type === 'leaf') return h(Leaf, { id: n.id, kind: n.kind });
    const kids = n.children.map(build);
    if (n.type === 'div') return h('div', {}, ...kids);
    if (n.type === 'region') return h('section', {}, () => kids.map((k) => k));
    if (n.type === 'list') return h('ol', {}, () => [h(Pass, { key: 'only' }, ...kids)]);
    badFallback.set(n.id, n.badFallback);
    return h(ErrorBoundary, {
      fallback: ({ reset }) => {
        resets.set(n.id, reset);
        if (n.badFallback) throw new Error(`fallback ${n.id}`);
        return h('b', { 'data-fb': String(n.id) });
      },
    }, ...kids);
  };

  // The model: which boundaries show their fallback.
  const fallen = new Set();
  const visible = (b) => { for (let p = b; p !== null; p = boundaryParent.get(p)) if (fallen.has(p)) return false; return true; };
  const leafAlive = (id) => visible(leafOwner.get(id));
  // The boundary catches: its children are disposed for its fallback. A
  // fallback that throws hands that error to the boundary above. Returns false
  // when an error reaches no boundary (it is logged).
  const fall = (b) => {
    for (; b !== null; b = boundaryParent.get(b)) {
      fallen.add(b);
      if (!badFallback.get(b)) return true;
    }
    return false;
  };

  const host = document.body.appendChild(document.createElement('div'));
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' ').slice(0, 200));
  const log = [];
  const where = () => `seed ${SEED} case ${c}\ntree ${JSON.stringify(tree.root)}\nsteps: ${log.join(', ')}`;
  let unmount = null;
  try {
    unmount = mount(build(tree.root), host);
    flushSync();
    for (let step = 0; step <= STEPS; step++) {
      let unhandled = false;
      if (step > 0) {
        const fallenVisible = [...fallen].filter(visible);
        const live = [...Array(tree.leaves).keys()].filter((id) => leafAlive(id) && !untrack(fail[id]));
        if (fallenVisible.length > 0 && (live.length === 0 || g.rnd() < 0.35)) {
          const b = g.pick(fallenVisible);
          log.push(`reset B${b}`);
          batch(() => {
            for (const id of under.get(b).leaves) { fail[id](false); rows[id](['a']); }
          });
          resets.get(b)();
          flushSync();
          fallen.delete(b);
          for (const inner of under.get(b).boundaries) fallen.delete(inner);
        } else if (live.length > 0) {
          const id = g.pick(live);
          log.push(`fail L${id}`);
          errors.length = 0;
          batch(() => {
            rows[id](['a', 'b']);
            fail[id](true);
          });
          flushSync();
          unhandled = !fall(leafOwner.get(id));
          if (unhandled) assert.ok(errors.length > 0, `an error with no boundary above it is logged\n${where()}`);
        } else {
          continue;
        }
      }
      if (!unhandled) assert.deepEqual(errors, [], `console.error at step ${step}\n${where()}`);
      errors.length = 0;

      const shown = [...host.querySelectorAll('[data-fb]')].map((el) => Number(el.getAttribute('data-fb'))).sort((a, b) => a - b);
      const expected = [...fallen].filter((b) => !badFallback.get(b) && visible(boundaryParent.get(b))).sort((a, b) => a - b);
      assert.deepEqual(shown, expected, `fallbacks shown at step ${step}\n${where()}`);

      beats.fill(0);
      beat((n) => n + 1);
      flushSync();
      const answered = beats.map((n, id) => [id, n]).filter(([, n]) => n > 0);
      const alive = [...Array(tree.leaves).keys()].filter(leafAlive).map((id) => [id, 1]);
      assert.deepEqual(answered, alive, `leaves answering a write at step ${step} ([id, runs])\n${where()}`);
    }
    unmount();
    unmount = null;
    beats.fill(0);
    beat((n) => n + 1);
    for (const f of fail) f(false);
    flushSync();
    assert.ok(beats.every((n) => n === 0), `a leaf answered after unmount\n${where()}`);
    if (__DEV__) {
      assert.equal(__subsOf(beat).length, 0, `beat keeps subscribers after unmount\n${where()}`);
      assert.ok(fail.every((f) => __subsOf(f).length === 0), `a fail signal keeps subscribers after unmount\n${where()}`);
    }
  } finally {
    console.error = originalError;
    if (unmount) unmount();
    host.remove();
  }
}

describe('error boundary fuzz: random trees, random failures, resets', () => {
  it(`agrees with the model (seed ${SEED}, ${CASES} cases)`, async () => {
    for (let c = 0; c < CASES; c++) await runCase(c);
  });
});
