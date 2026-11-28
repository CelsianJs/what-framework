// One shard of form-control-oracle.test.js, run in a worker thread: the cases
// of the shapes whose ids it is given, in JSDOM, with the shapes' components
// compiled for this shard alone. It posts { server, client }, each
// { cases, findings }, findings in the order the cases ran; the test merges
// the shards back into the order of a single run.

import { parentPort, workerData } from 'node:worker_threads';
import { installDOM } from '../../../../test-utils/dom.js';
import { loadCompiled } from '../../../../test-utils/load-compiled.js';
import { shapes, jsxModule, hComponent, runClient, checkServerHtml, editsEarly } from './form-oracle.js';

installDOM();
const { h, mount, hydrate, flushSync, signal, For, Show } = await import('../../../core/src/index.js');
const { _resetForm, _changedFields } = await import('../../../core/src/dom.js');
const { renderToString, renderToHydratableString, renderToStream } = await import('../../src/index.js');

const changedFields = (el) => {
  const out = [];
  _changedFields(el, out, new WeakSet());
  return out.length;
};
const env = { h, mount, hydrate, flushSync, signal, resetForm: _resetForm, changedFields, For, Show, document };
const ids = new Set(workerData.ids);
const SHAPES = shapes().filter((shape) => ids.has(shape.id));

async function stream(view) {
  let html = '';
  for await (const chunk of renderToStream(view)) html += chunk;
  return html;
}

const RENDERERS = { string: renderToString, hydratable: renderToHydratableString, stream };

// One module per build holds the shard's components (C<id>, S<id>, W<id>).
const source = jsxModule(SHAPES);
const client = await loadCompiled(source);
const hydratableClient = await loadCompiled(source, { pluginOptions: { hydratable: true } });
const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });

// The component of `shape` an authoring builds: 'h', 'compiled', 'spread',
// 'wrapped'.
const LETTER = { compiled: 'C', spread: 'S', wrapped: 'W' };
function component(shape, authoring, build) {
  if (authoring === 'h') return hComponent(h, shape, env);
  return build[`${LETTER[authoring]}${shape.id}`];
}

// The server markup each authoring hydrates: the others all render the same
// form; a wrapped field's wrappers render elements of their own.
const SOURCES = ['h:hydratable', 'h:stream', 'compiled:hydratable', 'spread:hydratable'];
const sourcesFor = (authoring) => (authoring === 'wrapped' ? ['wrapped:hydratable', 'wrapped:stream'] : SOURCES);

// Every server renderer shows each field as its equivalent static HTML
// before hydration. A select whose options come later shows none before
// hydration, so only the shapes that edit early are checked.
async function serverCases() {
  const findings = [];
  let cases = 0;
  for (const shape of SHAPES.filter(editsEarly)) {
    for (const authoring of ['h', 'compiled', 'spread', 'wrapped']) {
      for (const [renderer, render] of Object.entries(RENDERERS)) {
        cases++;
        const v = shape.binding === 'signal' || shape.binding === 'accessor' ? signal(shape.initial) : undefined;
        let html;
        try {
          html = await render(h(component(shape, authoring, server), { v, o: signal(true), l: signal(false) }));
        } catch (error) {
          findings.push({ shape, authoring, renderer, problem: `threw: ${error.message}` });
          continue;
        }
        const found = checkServerHtml(env, shape, html);
        if (found) findings.push({ shape, authoring, renderer, ...found });
      }
    }
  }
  return { cases, findings };
}

// Every client path follows the reference model through mount, hydration,
// writes, edits, resets and release.
async function clientCases() {
  const findings = [];
  let cases = 0;
  const markup = async (shape, from) => {
    const [authoring, renderer] = from.split(':');
    const v = shape.binding === 'signal' || shape.binding === 'accessor' ? signal(shape.initial) : undefined;
    return RENDERERS[renderer](h(component(shape, authoring, server), { v, o: signal(shape.late === undefined), l: signal(false) }));
  };
  for (const shape of SHAPES) {
    for (const authoring of ['h', 'compiled', 'spread', 'wrapped']) {
      cases++;
      const mounted = await runClient(env, shape, component(shape, authoring, client));
      if (mounted) findings.push({ shape, path: `${authoring} mount`, ...mounted });
      for (const from of sourcesFor(authoring)) {
        cases++;
        const html = await markup(shape, from);
        const found = await runClient(env, shape, component(shape, authoring, hydratableClient), html);
        if (found) findings.push({ shape, path: `${authoring} hydrating ${from}`, html, ...found });
        if (!editsEarly(shape)) continue;
        cases++;
        const early = await runClient(env, shape, component(shape, authoring, hydratableClient), html, true);
        if (early) findings.push({ shape, path: `${authoring} hydrating ${from}, edited before`, html, ...early });
      }
    }
  }
  return { cases, findings };
}

// Findings cross to the test as JSON, which is how its report prints them.
const result = { server: await serverCases(), client: await clientCases() };
parentPort.postMessage(JSON.stringify(result));
