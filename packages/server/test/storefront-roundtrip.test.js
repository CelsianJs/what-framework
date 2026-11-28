import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installDOM } from '../../../test-utils/dom.js';
import { expectDiagnostic, expectNoDiagnostics, expectRuns } from 'what-framework/testing';
import { applyStreamedBoundaries } from 'what-framework';
import { __resetHydrationData } from 'what-core/internal';
import { updatedState } from './fixtures/storefront-observations.js';
import { asDocument, loadStorefront, modes, serverPage, stock } from './fixtures/storefront-roundtrip.js';

let env;
let run;
let fresh;
let freshHydratable;
before(async () => {
  env = installDOM();
  ({ exerciseStorefront: run } = await import('./fixtures/storefront-client.js'));
  fresh = await run((await loadStorefront('dom')).createStorefront, 'client');
  freshHydratable = await run((await loadStorefront('hydratable')).createStorefront, 'client');
});
after(() => env.cleanup());

function withDocument(html, fn) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/' });
  const saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  __resetHydrationData();
  return Promise.resolve().then(() => fn(dom.window.document)).finally(() => {
    Object.assign(globalThis, saved);
    dom.window.close();
  });
}

// The interactions are input, sort, cart and like (an optimistic action).
function expectInteractionBudgets(budgets) {
  assert.equal(budgets.length, 4);
  for (const [index, capture] of budgets.entries()) {
    expectNoDiagnostics(capture);
    expectRuns(capture, { effect: 'observeName', max: index === 0 ? 1 : 0 });
    expectRuns(capture, { effect: 'observeSort', max: index === 1 ? 1 : 0 });
    assert.equal(capture.runs.observeName ?? 0, Number(index === 0));
    assert.equal(capture.runs.observeSort ?? 0, Number(index === 1));
    assert.ok(Object.values(capture.runs).reduce((total, count) => total + count, 0) <= [4, 16, 4, 6][index]);
  }
}

it('fresh storefront keeps input and rows live within interaction budgets', () => {
  expectNoDiagnostics(fresh);
  assert.deepEqual(fresh.warnings, []);
  assert.deepEqual(fresh.interaction, updatedState);
  assert.equal(fresh.retainedAfterSort, true);
  assert.equal(fresh.optimisticLike, 'Likes 1');
  assert.deepEqual(fresh.fetches, ['stock', 'rating', 'delivery']);
  assert.equal(fresh.settled.description, stock);
  expectInteractionBudgets(fresh.budgets);
});

it('a hydratable build renders on the client as the default build does', () => {
  expectNoDiagnostics(freshHydratable);
  assert.deepEqual(freshHydratable.warnings, []);
  assert.deepEqual(freshHydratable.settled, fresh.settled);
  assert.deepEqual(freshHydratable.interaction, updatedState);
  assert.equal(freshHydratable.retainedAfterSort, true);
  assert.equal(freshHydratable.optimisticLike, 'Likes 1');
  assert.deepEqual(freshHydratable.fetches, ['stock', 'rating', 'delivery']);
  expectInteractionBudgets(freshHydratable.budgets);
});


for (const client of ['jsx-runtime', 'hydratable']) {
  for (const target of ['jsx-runtime', 'ssr']) {
    describe(`${client} client, ${target} server`, () => {
      for (const mode of modes) {
        it(mode + ' round trip', async () => {
          const { html, chunks, calls } = await serverPage(await loadStorefront(target), mode);
          if (chunks) {
            let prefix = '';
            const progression = [];
            for (const chunk of chunks) {
              prefix += chunk;
              await withDocument(asDocument(prefix, mode), doc => {
                if (mode.endsWith('noScripts')) {
                  assert.ok([...doc.scripts].every(script => script.type === 'application/json'));
                  applyStreamedBoundaries();
                }
                assert.equal(doc.querySelector('h1')?.textContent, 'Market');
                assert.equal(doc.querySelector('#customer')?.textContent, 'Customer: Ada');
                assert.equal(doc.querySelector('#name')?.value, 'Ada');
                const head = doc.head.querySelector('meta[name="description"]');
                if (mode.startsWith('document')) {
                  assert.equal(head?.content, progression.length === 0 ? undefined : stock);
                }
                progression.push([
                  doc.querySelector('#stock-fallback')?.textContent ?? null,
                  doc.querySelector('#delivery-fallback')?.textContent ?? null,
                  doc.querySelector('#delivery')?.textContent ?? null,
                ]);
              });
            }
            assert.deepEqual(progression, [
              ['Checking stock', null, null],
              [null, 'Checking delivery', null],
              [null, null, 'Delivery tomorrow'],
            ]);
          }

          const { createStorefront } = await loadStorefront(client);
          const result = await withDocument(asDocument(html, mode), () => run(createStorefront, mode));
          const synchronous = !mode.includes('stream') && !mode.startsWith('document');
          // A synchronous render stops at the stock resource, which suspends
          // the component before it makes its rating.
          assert.deepEqual(calls, synchronous ? ['stock'] : ['stock', 'rating', 'delivery']);
          assert.deepEqual({
            settled: result.settled,
            replaced: result.replaced,
            fetches: result.fetches,
            interaction: result.interaction,
            lateHead: result.serverView.description ?? null,
          }, {
            settled: fresh.settled,
            // Synchronous rendering ships the fallback, whose removal is expected.
            replaced: synchronous ? ['stock-fallback'] : [],
            fetches: synchronous ? ['stock', 'rating', 'delivery'] : [],
            interaction: updatedState,
            lateHead: mode.startsWith('document') ? stock : null,
          });
          // Markup that carries the protocol is adopted without a node added,
          // on every pair of client and server: the h() JSX runtime evaluates
          // `{`Customer: ${...}`}` where it is written, so the h() server
          // writes plain text there, and the compiled client's reactive region
          // takes that text node as it is. A synchronous render's fallback is
          // replaced by the children.
          if (!synchronous) assert.equal(result.created, 0);
          expectNoDiagnostics(result);
          assert.deepEqual(result.warnings, []);
          assert.equal(result.retainedAfterSort, true);
          assert.equal(result.optimisticLike, 'Likes 1');
          expectInteractionBudgets(result.budgets);
        });
      }
    });
  }
}

it('diagnostic assertions catch missing context in a mounted component', async () => {
  const { captureDiagnostics } = await import('what-framework/testing');
  const { createContext, h, mount, useContext } = await import('what-framework');
  const context = createContext();
  function MissingProvider() {
    useContext(context);
    return h('p', null, 'Missing provider');
  }
  const captured = captureDiagnostics(() => mount(h(MissingProvider), env.document.body));
  try {
    expectDiagnostic(captured, { code: 'ERR_CONTEXT_NOT_PROVIDED' });
  } finally {
    captured.result();
  }
});

it('hydrated keyed rows retain their nodes on the first reorder', async () => {
  const { html } = await serverPage(await loadStorefront('jsx-runtime'), 'document');
  for (const client of ['jsx-runtime', 'hydratable']) {
    const { createStorefront } = await loadStorefront(client);
    const result = await withDocument(html, () => run(createStorefront, 'document'));
    assert.deepEqual(result.interaction.products, ['Pear', 'Apple']);
    assert.equal(result.retainedAfterSort, true, `${client}: the initially adopted Pear row should move with its key`);
  }
});

it('hydrating a document keeps one copy of each Head meta tag', async () => {
  const fixture = await loadStorefront('jsx-runtime');
  const observed = {};
  for (const mode of ['document', 'document stream', 'document stream noScripts']) {
    const { html } = await serverPage(fixture, mode);
    const { createStorefront } = await loadStorefront('jsx-runtime');
    const result = await withDocument(html, () => run(createStorefront, mode));
    observed[mode] = result.headCounts;
  }
  assert.deepEqual(observed, {
    document: [1, 1],
    'document stream': [1, 1],
    'document stream noScripts': [1, 1],
  });
});
