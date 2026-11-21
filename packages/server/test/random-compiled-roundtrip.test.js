// The randomized round trip for a compiled client. Each seed's page is JSX
// source, compiled three ways from the same text: what-compiler's server
// target and the automatic JSX runtime (h()) render it on the server, and
// what-compiler's client target built for hydration adopts it. Hydration
// adopts every element the server rendered. After it, and after every random
// write that follows, the page equals a fresh client render of the same
// state, and it keeps exactly the elements a page the client rendered itself
// keeps through the same writes: the nodes that existed before the step and
// still belong are the same objects.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { interactionScenario, writeState } from './fixtures/random-interactions.js';
import { visibleTree } from './fixtures/storefront-observations.js';

let env;
let core;
let renderDocument;
let resetHydration;
before(async () => {
  env = installDOM();
  core = await import('what-framework');
  ({ renderDocument } = await import('what-framework/server'));
  ({ __resetHydrationData: resetHydration } = await import('what-core/internal'));
});
after(() => env.cleanup());

// The scenario's structure as JSX. Every element has a data-k naming it, so a
// node can be found again after a step; a row is named by its item.
function pageSource(structure) {
  let k = 0;
  const leaf = (node) => {
    if (node.kind === 'group') return `<section data-k="${k++}">${node.children.map(leaf).join('')}</section>`;
    if (node.kind === 'list') return `<ul data-k="${k++}">{() => state().rows.map(row => <li key={row} data-k={'row-' + row}>{row}</li>)}</ul>`;
    if (node.kind === 'conditional') return `<div data-k="${k++}">{() => state().open && <em data-k="${k++}">${node.label ?? 'open'}</em>}</div>`;
    return `<p data-k="${k++}">${node.label} / {state().count}!</p>`;
  };
  return `
import { signal, Suspense, createResource } from 'what-framework';
export function createPage(initial, fetch, fresh) {
  const state = signal(initial, 'scenario state');
  function Resource() {
    const [read] = createResource(fetch, fresh ? { initialValue: 'stock' } : {});
    return <p data-k="resource">{() => read() || 'waiting'}</p>;
  }
  function Page() {
    return <main data-k="main"><output data-k="count">{state().count}</output>${structure.map(leaf).join('')}<Suspense fallback={<p data-k="waiting">waiting</p>}><Resource /></Suspense></main>;
  }
  return { Page, state };
}`;
}

let loads = 0;
async function load(source, target) {
  const code = target === 'jsx-runtime'
    ? (await transform(source, { loader: 'jsx', format: 'esm', jsx: 'automatic', jsxImportSource: 'what-framework' })).code
    : compileJSX(source, { pluginOptions: target === 'hydratable' ? { hydratable: true } : { generate: target } });
  const resolved = code.replace(/(['"])(what-framework(?:\/[\w-]+)?)\1/g, (_m, _q, entry) => JSON.stringify(import.meta.resolve(entry)))
    + `\n// load ${loads++}\n`;
  return import('data:text/javascript;base64,' + Buffer.from(resolved).toString('base64'));
}

function named(root) {
  const map = new Map();
  for (const el of root.querySelectorAll('[data-k]')) map.set(el.getAttribute('data-k'), el);
  map.set('main', root);
  return map;
}

function newNodes(root, before) {
  let count = 0;
  const walker = root.ownerDocument.createTreeWalker(root, root.ownerDocument.defaultView.NodeFilter.SHOW_ALL);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) if (!before.has(n)) count++;
  return count;
}

describe('a compiled client hydrates random pages from both server targets', () => {
  for (const seed of [1, 2, 3, 4, 15, 37, 49, 211, 1531, 104729]) {
    for (const target of ['ssr', 'jsx-runtime']) {
      it(`seed ${seed}, ${target} server`, { timeout: 5000 }, async () => {
        const { initial, structure, writes } = interactionScenario(seed);
        const source = pageSource(structure);
        const server = await load(source, target);
        const client = await load(source, 'hydratable');
        const { document } = env;
        const html = await renderDocument({ default: server.createPage(initial, async () => 'stock', false).Page });
        document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
        resetHydration();
        const main = document.querySelector('main');
        const serverNodes = new Set();
        const walker = document.createTreeWalker(main, document.defaultView.NodeFilter.SHOW_ALL);
        for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) serverNodes.add(n);
        const serverNamed = named(main);
        let fetches = 0;
        const page = client.createPage(initial, async () => { fetches++; return 'stock'; }, false);
        const reports = [];
        const stop = core.hydrate(core.h(page.Page), document.body, { onHydrationError: (info) => reports.push(info) });
        const freshHost = document.createElement('div');
        try {
          assert.deepEqual(reports, [], 'matching markup is not a mismatch');
          const hydrated = named(document.querySelector('main'));
          for (const [name, el] of serverNamed) assert.equal(hydrated.get(name), el, `${name} was rebuilt instead of adopted`);
          // The server target writes the protocol, so nothing is added. The
          // h() server renders `{state().count}` as plain text where the
          // compiler makes a region, which adds that region's markers.
          if (target === 'ssr') assert.equal(newNodes(main, serverNodes), 0, 'nodes added while hydrating matching markup');

          // The same page rendered by the client, driven through the same writes.
          const mountedHost = document.createElement('div');
          const mounted = client.createPage(initial, async () => 'stock', true);
          const unmountMounted = core.mount(core.h(mounted.Page), mountedHost);
          let state = initial;
          try {
            for (const [index, field] of [null, ...writes].entries()) {
              const before = named(document.querySelector('main'));
              const beforeMounted = named(mountedHost.firstElementChild);
              if (field) {
                state = writeState(state, field);
                page.state(state);
                mounted.state(state);
                core.flushSync();
              }
              const fresh = client.createPage(state, () => { throw new Error('unexpected fresh fetch'); }, true);
              const unmount = core.mount(core.h(fresh.Page), freshHost);
              try {
                assert.deepEqual(visibleTree(document.querySelector('main')), visibleTree(freshHost.firstElementChild),
                  'step ' + index + ' (' + field + ')');
                const afterStep = named(document.querySelector('main'));
                const afterMounted = named(mountedHost.firstElementChild);
                for (const [name, el] of before) {
                  assert.equal(afterStep.get(name) === el, afterMounted.get(name) === beforeMounted.get(name),
                    `step ${index} (${field}): ${name} kept on one page and rebuilt on the other`);
                }
              } finally {
                unmount();
              }
            }
          } finally {
            unmountMounted();
          }
          assert.equal(fetches, 0, 'the server sent the resource value');
        } finally {
          stop();
        }
      });
    }
  }
});
