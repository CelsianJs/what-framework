// The compiler's static reactivity analysis, by differential oracle
// (fixtures/reactivity-oracle.js has the space). Each generated module is
// compiled as written and as its reference, with every JSX expression a
// function; both are mounted, every signal is written, and the two DOMs must
// match after mount and after every write. A divergence is a read the
// analysis took for static that reads a signal; the report names the case,
// and its module source is the reproduction. Reads the analysis wrapped that
// never re-ran in the reference are false positives, counted and measured in
// bytes of emitted wrapper.
//
// The committed run is a fixed seed; a wider one is an environment variable
// away, and reproducible from its seed alone:
//   WHAT_REACTIVITY_CASES=50000 WHAT_REACTIVITY_SEED=7 node --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { makeRandom, generateCase, moduleSource, serialize, wrappedReads, pathological, SIGNALS } from './fixtures/reactivity-oracle.js';

installDOM();
const { h, mount, flushSync } = await import('../../core/src/index.js');

const CASES = Number(process.env.WHAT_REACTIVITY_CASES) || 3000;
const SEED = Number(process.env.WHAT_REACTIVITY_SEED) || 20261121;
const BATCH = 150;

function load(code) {
  const resolved = code.replace(/(['"])(what-framework(?:\/[\w-]+)?)\1/g, (_m, _q, entry) => JSON.stringify(import.meta.resolve(entry)));
  return import('data:text/javascript;base64,' + Buffer.from(resolved).toString('base64'));
}

describe('reactivity oracle', () => {
  it(`the analysed build renders what the all-reactive reference does, over ${CASES} generated cases`, async () => {
    const g = makeRandom(SEED);
    const divergences = [];
    let reads = 0;
    let falsePositives = 0;
    let falsePositiveBytes = 0;
    let wrappedCount = 0;
    for (let start = 0; start < CASES; start += BATCH) {
      const cases = Array.from({ length: Math.min(BATCH, CASES - start) }, (_, i) => generateCase(g, start + i));
      const analysedCode = compileJSX(moduleSource(cases, false));
      const [analysed, reference] = await Promise.all([load(analysedCode), load(compileJSX(moduleSource(cases, true)))]);
      const hosts = cases.map((c) => {
        const a = document.createElement('div');
        const r = document.createElement('div');
        const stops = [mount(h(analysed[`V${c.id}`]), a), mount(h(reference[`V${c.id}`]), r)];
        return { c, a, r, stops };
      });
      const compare = (step) => {
        for (const { c, a, r } of hosts) {
          if (divergences.some((d) => d.id === c.id)) continue;
          const got = serialize(a);
          const want = serialize(r);
          if (got !== want) divergences.push({ id: c.id, step, got, want, source: moduleSource([c], false) });
        }
      };
      compare('mount');
      for (let round = 1; round <= 2; round++) {
        for (let k = 0; k < SIGNALS; k++) {
          analysed[`s${k}`](`w${round}-${k}`);
          reference[`s${k}`](`w${round}-${k}`);
          flushSync();
          compare(`write s${k} (round ${round})`);
        }
      }
      for (const { stops } of hosts) for (const stop of stops) stop();
      // False positives: wrapped reads the reference never re-ran.
      const wrapped = wrappedReads(analysedCode);
      const count = cases.reduce((sum, c) => sum + c.reads.length, 0);
      reads += count;
      wrappedCount += wrapped.size;
      for (const i of wrapped) {
        if ((reference.runs[i] || 0) > 1) continue;
        falsePositives++;
        const at = analysedCode.indexOf(`/*@E${i}*/`);
        const line = analysedCode.slice(analysedCode.lastIndexOf('\n', at) + 1, at);
        falsePositiveBytes += line.includes('_$effect(() =>') ? '_$effect(() => )'.length : '() => '.length;
      }
    }
    console.log(`reactivity oracle: seed ${SEED}, ${CASES} cases, ${reads} reads, ${wrappedCount} wrapped, ` +
      `${divergences.length} divergences, ${falsePositives} false positives (${falsePositiveBytes} bytes of wrapper)`);
    assert.equal(divergences.length, 0, divergences.slice(0, 5).map((d) => `case ${d.id} at ${d.step}:\n  analysed  ${d.got}\n  reference ${d.want}\n${d.source}`).join('\n\n'));
  });

  it('never throws on deep and pathological shapes, and keeps them reactive', async () => {
    const g = makeRandom(SEED);
    for (const size of [50, 400, 2500]) {
      for (const [i, source] of pathological(g, size).entries()) {
        let code;
        assert.doesNotThrow(() => { code = compileJSX(source); }, `shape ${i} at size ${size}`);
        const { View, s0 } = await load(code);
        const host = document.createElement('div');
        const stop = mount(h(View), host);
        const before = host.textContent;
        s0('changed');
        flushSync();
        assert.notEqual(host.textContent, before, `shape ${i} at size ${size} stays reactive`);
        stop();
      }
    }
  });
});
