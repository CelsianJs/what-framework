import { installDOM } from '../../../test-utils/dom.js';
// Differential fuzz: a hydrated tree must end up identical to a client-only
// render of the same tree.
//
// Compare semantic DOM structure before/after writes, then prove disposal stops
// subscriptions. Ignore internal comment boundaries, not elements/attributes.
// The same corpus runs in isolated dev and production processes so corrections
// cannot accidentally become dev-only behavior.
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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODE = process.env.WHAT_HYDRATION_FUZZ_MODE;
// Dev mode is resolved at module evaluation, so each corpus needs an isolated
// process. Testing the same shapes in both configurations catches dev-gated
// DOM corrections, not just the warning behavior of one handwritten case.
globalThis.__WHAT_DEV__ = MODE !== 'production';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const { signal, flushSync } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { hydrate } = await import('../src/render.js');
const { mount, disposeTree } = await import('../src/dom.js');
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
      return (vals) => h(tag, { 'data-kind': tag, 'data-value': () => String(vals[0]()) }, ...kids.map((k) => k(vals)));
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

// Component/region comments deliberately differ between mount and hydration.
// Compare semantic element structure and attributes, merging adjacent text
// nodes across those comments rather than pinning their implementation shape.
function normalize(parent) {
  const children = [];
  for (const node of parent.childNodes) {
    if (node.nodeType === 8) continue;
    if (node.nodeType === 3) {
      if (!node.textContent) continue;
      if (typeof children.at(-1) === 'string') children[children.length - 1] += node.textContent;
      else children.push(node.textContent);
    } else if (node.nodeType === 1) {
      children.push([
        node.localName, node.namespaceURI,
        [...node.attributes].map((a) => [a.name, a.value]).sort((a, b) => a[0].localeCompare(b[0])),
        normalize(node),
      ]);
    }
  }
  return children;
}

if (!MODE) {
  describe('hydration differential corpus configurations', () => {
    for (const mode of ['development', 'production']) {
      it(`matches DOM structure, writes and disposal in ${mode}`, () => {
        const env = { ...process.env, WHAT_HYDRATION_FUZZ_MODE: mode };
        // node --test marks its workers through this private environment key.
        // Forwarding it makes a nested runner emit worker protocol bytes instead
        // of executing/reporting a normal test run.
        delete env.NODE_TEST_CONTEXT;
        const result = spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], {
          encoding: 'utf8', timeout: 30000,
          env,
        });
        assert.equal(result.status, 0, result.stderr + result.stdout);
        assert.match(result.stdout, /tests\s+1\b/, 'the child must report an executed corpus test');
        assert.match(result.stdout, /pass\s+1\b/, 'the corpus must report success, not just exit zero');
      });
    }
  });
} else describe(`hydration differential corpus (${MODE}, seed ${SEED})`, () => {
  it(`matches ${CASES} generated trees before/after writes and stops after disposal`, () => {
    const makeFactory = makeGenerator(SEED);
    const sig = (values) => values.map((v) => signal(v));
    let checked = 0;

    for (let n = 0; n < CASES; n++) {
      const factory = makeFactory(3);
      const client = document.createElement('div');
      const host = document.createElement('div');
      document.body.append(client, host);
      const clientSignals = sig(CLIENT_VALUES);
      const hydrationSignals = sig(CLIENT_VALUES);
      let ssr;
      try {
        // Only shapes valid for both rendering APIs belong to the oracle.
        // The minimum count below prevents generation failures from vacuously
        // passing, and cleanup still runs for every excluded shape.
        quiet(() => mount(factory(clientSignals), client));
        flushSync();
        ssr = renderToString(factory(sig(SERVER_VALUES)));
      } catch {
        disposeTree(client);
        client.remove();
        host.remove();
        continue; // a tree the client cannot render is not a hydration case
      }
      host.innerHTML = ssr;
      try {
        quiet(() => hydrate(factory(hydrationSignals), host));
        flushSync();
        const context = `seed ${SEED} case ${n} mode ${MODE}; SSR ${JSON.stringify(ssr)}`;
        assert.deepEqual(normalize(host), normalize(client), `initial DOM: ${context}`);
        for (const values of [[0, '', 'next', 'tail'], [9, 'again', '', '']]) {
          clientSignals.forEach((s, i) => s(values[i]));
          hydrationSignals.forEach((s, i) => s(values[i]));
          flushSync();
          assert.deepEqual(normalize(host), normalize(client), `after write ${JSON.stringify(values)}: ${context}`);
        }
        disposeTree(client);
        disposeTree(host);
        const disposedClient = normalize(client);
        const disposedHydrated = normalize(host);
        clientSignals.forEach((s, i) => s(CLIENT_VALUES[i]));
        hydrationSignals.forEach((s, i) => s(CLIENT_VALUES[i]));
        flushSync();
        assert.deepEqual(normalize(client), disposedClient, `client mutated after disposal: ${context}`);
        assert.deepEqual(normalize(host), disposedHydrated, `hydrated DOM mutated after disposal: ${context}`);
        checked++;
      } finally {
        disposeTree(client);
        disposeTree(host);
        client.remove();
        host.remove();
      }
    }
    assert.ok(
      checked >= CASES * 0.75,
      `only ${checked}/${CASES} trees reached the comparison; the generator is producing trees that cannot render`,
    );
  });
});
