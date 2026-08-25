import { installDOM } from '../../../test-utils/dom.js';
// Differential fuzz: a hydrated tree must end up identical to a client-only
// render of the same tree.
//
// That is the whole contract of hydration, and it is the only assertion here.
// It needs no knowledge of markers, cursors or claim rules, so it stays true if
// the implementation of any of them changes, and it does not have to be updated
// when someone finds the next shape.
//
// This exists because every hydration bug fixed in this release was found by a
// human building an app or by a reviewer hand-writing one adversarial tree at a
// time, and the hand-written cases each closed one shape while leaving the
// class open. Random trees do not have that blind spot. Scored against the same
// 400 generated cases:
//
//   0.12.2 as published, under browser conditions ... 186 / 400 divergent
//   0.12.2 with the dev-only correction forced on ...  32 / 400
//   this release .....................................  0 / 400
//
// The generator is a seeded LCG, so a failure is reproducible from its case
// number and the whole run is deterministic across machines and CI.
//
// If this starts failing, do not chase the printed textContent. Print the case
// number, rebuild that one tree, and look at `hyd html`: the marker layout is
// where the answer is.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const { signal, flushSync } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { hydrate } = await import('../src/render.js');
const { mount } = await import('../src/dom.js');
const { renderToString } = await import('what-server');

const CASES = 400;
const SEED = 12345;

// Server and client deliberately disagree on every value, which is the point:
// hydration is only interesting when the client knows something the server did
// not. Note the shapes covered by the pairing: a value that gains content
// (''->'ERR'), one that loses it ('q'->''), one that changes type (0->7), and
// one that changes text ('x'->'zz').
const SERVER_VALUES = [0, 'x', '', 'q'];
const CLIENT_VALUES = [7, 'zz', 'ERR', ''];

function makeGenerator(seed) {
  let state = seed;
  const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  // Returns a factory taking the signal array, so the server tree and the
  // client tree are structurally identical and differ only in signal values.
  function makeFactory(depth) {
    const kinds = depth > 0
      ? ['text', 'rtext', 'el', 'cmp', 'cond']
      : ['text', 'rtext'];
    const kind = pick(kinds);

    // A static text child. ' ' is in the set on purpose: a lone space is the
    // classic thing an SSR walk loses or duplicates.
    if (kind === 'text') {
      const t = pick(['A', 'B', 'static-', ' ']);
      return () => t;
    }
    // A reactive text child, which is what serializes to nothing when empty.
    if (kind === 'rtext') {
      const i = Math.floor(rnd() * 4);
      return (vals) => () => String(vals[i]());
    }
    // A conditional region whose falsy arm is '' rather than null, so it
    // exercises the empty-text path rather than the null path.
    if (kind === 'cond') {
      const i = Math.floor(rnd() * 4);
      const inner = makeFactory(depth - 1);
      return (vals) => () => (vals[i]() ? h('em', {}, inner(vals)) : '');
    }

    const n = 1 + Math.floor(rnd() * 3);
    const kids = Array.from({ length: n }, () => makeFactory(depth - 1));
    if (kind === 'el') {
      const tag = pick(['div', 'span', 'section']);
      return (vals) => h(tag, {}, ...kids.map((k) => k(vals)));
    }
    // A component, which realizes to a fragment and so takes a different
    // reconciliation path than a plain element.
    const tag = pick(['div', 'span']);
    const Cmp = (vals) => () => h(tag, { 'data-c': '' }, ...kids.map((k) => k(vals)));
    return (vals) => h(Cmp(vals), {});
  }

  return makeFactory;
}

/** Silence the dev mismatch warnings; this asserts on the DOM, not the log. */
function quiet(fn) {
  const original = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = original; }
}

describe('a hydrated tree matches a client-only render of the same tree', () => {
  const divergent = [];
  const threw = [];
  let checked = 0;

  before(() => {
    const makeFactory = makeGenerator(SEED);
    const sig = (values) => values.map((v) => signal(v));

    for (let n = 0; n < CASES; n++) {
      const factory = makeFactory(3);

      // 1. What the client alone produces. This is the reference answer.
      document.body.innerHTML = '<div id="client"></div>';
      let clientOnly;
      try {
        quiet(() => mount(factory(sig(CLIENT_VALUES)), '#client'));
        flushSync();
        clientOnly = document.getElementById('client').textContent;
      } catch {
        continue; // a tree the client cannot render is not a hydration case
      }

      // 2. Server-render it with the server's values, then hydrate with the
      //    client's. The result must be indistinguishable from step 1.
      let ssr;
      try {
        ssr = renderToString(factory(sig(SERVER_VALUES)));
      } catch {
        continue;
      }

      document.body.innerHTML = `<div id="host">${ssr}</div>`;
      const host = document.getElementById('host');
      try {
        quiet(() => hydrate(factory(sig(CLIENT_VALUES)), host));
        flushSync();
      } catch (e) {
        threw.push({ n, ssr, message: e.message });
        continue;
      }

      checked++;
      if (host.textContent !== clientOnly) {
        divergent.push({
          n,
          ssr,
          expected: clientOnly,
          actual: host.textContent,
          html: host.innerHTML,
        });
      }
    }
  });

  it('actually exercised the generated trees', () => {
    // Both loops above `continue` past trees the client or the server cannot
    // render at all. Without this, a generator change that made every tree fail
    // early would leave a fuzz suite that checks nothing and passes: the exact
    // shape of green-but-inert test this file exists to catch.
    assert.ok(
      checked >= CASES * 0.75,
      `only ${checked}/${CASES} trees reached the comparison; the generator is producing trees that cannot render`,
    );
  });

  it(`renders ${CASES} generated trees without throwing`, () => {
    assert.deepEqual(
      threw.map((t) => `#${t.n}: ${t.message}`),
      [],
      'hydration must never throw: it aborts the whole page, leaving it inert',
    );
  });

  it('produces byte-identical text for every generated tree', () => {
    const report = divergent.slice(0, 5).map((d) => [
      `case #${d.n}`,
      `  ssr        : ${JSON.stringify(d.ssr)}`,
      `  client-only: ${JSON.stringify(d.expected)}`,
      `  hydrated   : ${JSON.stringify(d.actual)}`,
      `  hyd html   : ${JSON.stringify(d.html)}`,
    ].join('\n')).join('\n\n');

    assert.equal(
      divergent.length,
      0,
      `${divergent.length}/${checked} hydrated trees diverged from a client render:\n\n${report}`,
    );
  });
});
