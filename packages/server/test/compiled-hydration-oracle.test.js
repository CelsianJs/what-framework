// The compiled-JSX hydration oracle. Compiled JSX hydration kept producing
// new shapes that went wrong, round after round, so random component trees
// from a grammar (fixtures/hydration-oracle.js) are each compiled twice, for
// the server and for the client with `hydratable`, rendered on the server,
// edited in every form control as a user does while the page loads, and
// hydrated. For each it asserts:
//   - no ERR_HYDRATION_MISMATCH (no onHydrationError call);
//   - every element the server rendered is the page's, by node identity;
//   - every edit made before hydration is kept;
//   - a later signal write updates the page in place;
//   - after it, the page is structurally what a fresh mount() of the same
//     tree renders.
// CI runs a fixed seed; WHAT_HYDRATION_CASES and WHAT_HYDRATION_SEED run more
// or other cases locally. Every tree passes, at any seed; the run fails on the
// first divergence and prints every one.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { generateCase, random, structure, editControls, readControls, quietly } from './fixtures/hydration-oracle.js';

const env = installDOM();
const { h, hydrate, mount, flushSync } = await import('what-core');
const { __resetHydrationData } = await import('what-core/internal');
const { renderToHydratableString } = await import('../src/index.js');

const CASES = Number(process.env.WHAT_HYDRATION_CASES || 300);
const SEED = Number(process.env.WHAT_HYDRATION_SEED || 20261122);

/** The first finding of `source`, or null. */
async function checkCase(source) {
  const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
  const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
  __resetHydrationData();
  const host = document.createElement('div');
  document.body.append(host);
  const fresh = document.createElement('div');
  document.body.append(fresh);
  let stop = null;
  let stopFresh = null;
  try {
    host.innerHTML = renderToHydratableString(h(server.Page));
    const serverElements = [...host.querySelectorAll('*')];
    const edits = editControls(host);
    const problems = [];
    stop = hydrate(h(client.Page), host, { onHydrationError: (info) => problems.push(`${info.kind} at ${info.path}: ${info.expected} / ${info.found}`) });
    flushSync();
    if (problems.length > 0) return { step: 'hydrate', problems };
    const replaced = serverElements.filter((el) => !el.isConnected).map((el) => el.localName + (el.className ? '.' + el.className : ''));
    if (replaced.length > 0) return { step: 'adopt', replaced };
    const shown = readControls(host);
    if (JSON.stringify(shown) !== JSON.stringify(edits)) return { step: 'edits', edits, shown };
    const live = host.querySelector('div.live');
    client.n(client.n() + 1);
    flushSync();
    if (!live.isConnected || live.textContent !== String(client.n())) return { step: 'write', live: live.textContent };
    stopFresh = mount(h(client.Page), fresh);
    flushSync();
    const hydrated = structure(host.innerHTML);
    const mounted = structure(fresh.innerHTML);
    if (hydrated !== mounted) return { step: 'structure', hydrated, mounted };
    return null;
  } catch (error) {
    return { step: 'threw', error: String(error && error.stack || error) };
  } finally {
    stop?.();
    stopFresh?.();
    host.remove();
    fresh.remove();
    client.n(0);
  }
}

describe('compiled-JSX hydration oracle', () => {
  it(`${CASES} random trees (seed ${SEED}) hydrate by adoption, keep every early edit, update in place and match a fresh mount`, async () => {
    const next = random(SEED);
    const findings = [];
    for (let i = 0; i < CASES; i++) {
      const { id, source } = generateCase(i, next);
      const found = await quietly(() => checkCase(source));
      if (found) findings.push({ id, ...found, source });
    }
    console.log(`hydration oracle: ${CASES} cases, ${findings.length} findings`);
    for (const f of findings) console.log(`  #${f.id} ${f.step}: ${JSON.stringify(f.problems ?? f.replaced ?? f.error ?? '').slice(0, 200)}`);
    assert.equal(findings.length, 0, `${findings.length} of ${CASES} cases diverge:\n${findings.slice(0, 5).map((f) => JSON.stringify(f, null, 1)).join('\n')}`);
  });
});

process.on('exit', () => env.cleanup());
