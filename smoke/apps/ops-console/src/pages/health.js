// /health: the console's own diagnostics page. Server-rendered, zero JavaScript
// shipped for it (entry-client.js hydrates the console and nothing else).
//
// Two things live here:
//
//   1. The metrics roll-up, behind a Suspense boundary. createResource on the
//      server throws its pending promise, so the FIRST render pass emits the
//      fallback; renderToStringAsync awaits the resource and re-renders with
//      real numbers, and those numbers are also emitted into #__what_data.
//
//   2. An SSR self-test that renders the exact same panel twice, once
//      synchronously and once asynchronously, and shows both results. A
//      synchronous render cannot await, so it can only produce the fallback.
//      That is the difference an operator is looking at, and it is also the
//      only way to SEE the fallback: by the time the page is served, the async
//      render has already replaced it.
//
// This module is deliberately NOT in the static allowlist in server.js, so it
// can import the incident store directly.

import { Head, Suspense, createResource, h } from 'what-framework';
import { renderToString, renderToStringAsync } from 'what-framework/server';

import { Footer, TopBar } from '../components/chrome.js';
import { BOOT_AT, summarize } from '../data/incidents.js';
import { clock } from '../lib/format.js';

const SUMMARY_KEY = 'ops-summary';

function SummarySkeleton() {
  return h('p', { class: 'skeleton', 'data-summary-skeleton': '' },
    'Rolling up incident metrics...');
}

function metric(label, value, key) {
  return h('div', { class: 'metric' },
    h('dt', {}, label),
    h('dd', { [`data-metric-${key}`]: '' }, String(value)),
  );
}

function SummaryPanel() {
  // `key` matters twice: it names the entry in #__what_data, and it is what a
  // client-side createResource would seed from instead of refetching.
  const [summary] = createResource(summarize, { key: SUMMARY_KEY });
  const s = summary();
  return h('dl', { class: 'metrics', 'data-summary': '' },
    metric('Open', s.open, 'open'),
    metric('Acknowledged', s.acknowledged, 'acknowledged'),
    metric('Tracked', s.total, 'total'),
    metric('Critical', s.bySeverity.critical, 'critical'),
    metric('Services', s.services, 'services'),
  );
}

const probe = () => h(Suspense, { fallback: h(SummarySkeleton, {}) }, h(SummaryPanel, {}));

export const loader = async () => {
  const syncPass = renderToString(probe());
  const { body: asyncPass } = await renderToStringAsync(probe());
  return { syncPass, asyncPass, bootAt: BOOT_AT };
};

export default function Health({ loaderData }) {
  const { syncPass, asyncPass, bootAt } = loaderData;
  const fallbackFirst = syncPass.includes('data-summary-skeleton');
  const resolvedAfter = asyncPass.includes('data-summary')
    && !asyncPass.includes('data-summary-skeleton');

  return h('div', { class: 'app' },
    h(Head, {
      title: 'Health | Northwind Ops',
      meta: [{ name: 'description', content: 'Render pipeline diagnostics and incident metrics.' }],
    }),
    h(TopBar, { current: 'health' }),

    h('main', { class: 'container' },
      h('h1', {}, 'Health'),
      h('p', { class: 'lede' },
        'Everything on this page is server-rendered. The panel below sits behind a ',
        h('code', {}, 'Suspense'),
        ' boundary and its data arrives from a ',
        h('code', {}, 'createResource'),
        ' that suspends during SSR.'),

      h('section', { class: 'card' },
        h('h2', {}, 'Incident metrics'),
        h(Suspense, { fallback: h(SummarySkeleton, {}) }, h(SummaryPanel, {})),
      ),

      h('section', { class: 'card' },
        h('h2', {}, 'SSR suspense self-test'),
        h('p', {
          class: fallbackFirst && resolvedAfter ? 'verdict pass' : 'verdict fail',
          'data-selftest': fallbackFirst && resolvedAfter ? 'pass' : 'fail',
        }, fallbackFirst && resolvedAfter
          ? 'PASS: the synchronous pass emits the fallback, the async pass emits resolved data.'
          : 'FAIL: the two render passes did not differ as expected.'),

        h('h3', {}, 'renderToString (synchronous, cannot await)'),
        h('pre', { class: 'code', 'data-selftest-sync': '' }, syncPass),

        h('h3', {}, 'renderToStringAsync (awaits the resource, re-renders)'),
        h('pre', { class: 'code', 'data-selftest-async': '' }, asyncPass),
      ),

      h('section', { class: 'card' },
        h('h2', {}, 'Process'),
        h('dl', { class: 'metrics' },
          metric('Feed epoch', clock(bootAt), 'epoch'),
          metric('Store', 'in-memory', 'store'),
        ),
      ),
    ),

    h(Footer, {}),
  );
}
