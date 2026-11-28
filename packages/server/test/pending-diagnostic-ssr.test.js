// ERR_PENDING_READ_UNTRACKED decides whether a pending() or isPending() read is
// tracked. A server runs every binding once, untracked, so it used to report
// the read the docs recommend, in a child or attribute binding, as a
// component-body read. Every server renderer now gives the client's answer: a
// read while the component's function runs is reported, a read in a binding
// is not.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { h, Suspense, computed, isPending, getDiagnostics, clearDiagnostics } = await import('what-core');
const { renderToString, renderToHydratableString, renderToStringAsync, renderToStream } = await import('../src/index.js');

const codes = () => getDiagnostics({ since: 0 }).events.map((e) => e.code);
beforeEach(() => clearDiagnostics());

function InBindings() {
  const report = computed(async () => 'Ready');
  return h('p', { class: () => (report.pending() ? 'stale' : 'fresh') },
    () => (report.pending() || isPending(() => report()) ? 'Refreshing' : 'Done'));
}

function InBody() {
  const report = computed(async () => 'Ready');
  const refreshing = report.pending();
  return h('p', null, refreshing ? 'Refreshing' : 'Done');
}

async function streamed(node) {
  let html = '';
  for await (const chunk of renderToStream(node)) html += chunk;
  return html;
}

const renderers = {
  renderToString: (node) => renderToString(node),
  renderToHydratableString: (node) => renderToHydratableString(node),
  renderToStringAsync: async (node) => (await renderToStringAsync(h(Suspense, { fallback: 'Loading' }, node))).body,
  renderToStream: (node) => streamed(h(Suspense, { fallback: 'Loading' }, node)),
};

describe('ERR_PENDING_READ_UNTRACKED on the server', () => {
  for (const [name, render] of Object.entries(renderers)) {
    it(`${name}: silent for reads in a child and an attribute binding`, async () => {
      await render(h(InBindings));
      assert.deepEqual(codes(), []);
    });

    it(`${name}: reported for a read in the component's function`, async () => {
      await render(h(InBody));
      assert.deepEqual([...new Set(codes())], ['ERR_PENDING_READ_UNTRACKED']);
    });
  }

  it('compiled JSX: silent in JSX, reported in the function', async () => {
    const { Bound, Body } = await loadCompiled(`
      import { computed } from 'what-framework';
      export function Bound() {
        const report = computed(async () => 'Ready');
        return <p class={report.pending() ? 'stale' : 'fresh'}>{report.pending() ? 'Refreshing' : 'Done'}</p>;
      }
      export function Body() {
        const report = computed(async () => 'Ready');
        const refreshing = report.pending();
        return <p>{refreshing ? 'Refreshing' : 'Done'}</p>;
      }
    `, { pluginOptions: { generate: 'ssr' } });
    renderToString(h(Bound));
    await streamed(h(Bound));
    assert.deepEqual(codes(), []);
    renderToString(h(Body));
    assert.deepEqual([...new Set(codes())], ['ERR_PENDING_READ_UNTRACKED']);
  });
});
