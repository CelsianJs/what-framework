// Form-control conformance, by differential oracle (fixtures/form-oracle.js
// has the space, the reference model and its sources). Every field shape is
// rendered by every server renderer and compared with the browser's parse of
// the equivalent static HTML, then mounted and hydrated by every client path
// (each hydration also after a user edit made before it runs) and compared
// with the model after each step of its script. The run must end
// with no finding; a finding names the shape, the path and the step, which
// reproduce it.
//
// Widen or reseed nothing here: the space is enumerated, not sampled.
// form-control-oracle-chromium.test.js runs part of it in a real browser.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { shapes, jsxModule, hComponent, runClient, checkServerHtml, editsEarly } from './fixtures/form-oracle.js';

installDOM();
const { h, mount, hydrate, flushSync, signal, For, Show } = await import('../../core/src/index.js');
const { _resetForm } = await import('../../core/src/dom.js');
const { renderToString, renderToHydratableString, renderToStream } = await import('../src/index.js');

const env = { h, mount, hydrate, flushSync, signal, resetForm: _resetForm, For, Show, document };
const SHAPES = shapes();

async function stream(view) {
  let html = '';
  for await (const chunk of renderToStream(view)) html += chunk;
  return html;
}

const RENDERERS = { string: renderToString, hydratable: renderToHydratableString, stream };

// One module per build holds every shape's components (C<id>, S<id>).
let client;
let hydratableClient;
let server;

before(async () => {
  const source = jsxModule(SHAPES);
  [client, hydratableClient, server] = await Promise.all([
    loadCompiled(source),
    loadCompiled(source, { pluginOptions: { hydratable: true } }),
    loadCompiled(source, { pluginOptions: { generate: 'ssr' } }),
  ]);
});

// The component of `shape` an authoring builds: 'h', 'compiled', 'spread'.
function component(shape, authoring, build) {
  if (authoring === 'h') return hComponent(h, shape, env);
  return build[`${authoring === 'spread' ? 'S' : 'C'}${shape.id}`];
}

function report(findings, total) {
  const lines = findings.slice(0, 12).map((f) => JSON.stringify(f));
  return `${findings.length} of ${total} cases diverge:\n${lines.join('\n')}`;
}

describe('form-control oracle', () => {
  it('every server renderer shows each field as its equivalent static HTML before hydration', async () => {
    const findings = [];
    let cases = 0;
    // A select whose options come later shows none before hydration.
    for (const shape of SHAPES.filter(editsEarly)) {
      for (const authoring of ['h', 'compiled', 'spread']) {
        for (const [renderer, render] of Object.entries(RENDERERS)) {
          cases++;
          const v = shape.binding === 'signal' || shape.binding === 'accessor' ? signal(shape.initial) : undefined;
          let html;
          try {
            html = await render(h(component(shape, authoring, server), { v, o: signal(true) }));
          } catch (error) {
            findings.push({ shape, authoring, renderer, problem: `threw: ${error.message}` });
            continue;
          }
          const found = checkServerHtml(env, shape, html);
          if (found) findings.push({ shape, authoring, renderer, ...found });
        }
      }
    }
    console.log(`form oracle: ${cases} server cases, ${findings.length} findings`);
    assert.equal(findings.length, 0, report(findings, cases));
  });

  it('every client path follows the reference model through mount, hydration, writes, edits, resets and release', async () => {
    const findings = [];
    let cases = 0;
    const markup = async (shape, source) => {
      const [authoring, renderer] = source.split(':');
      const v = shape.binding === 'signal' || shape.binding === 'accessor' ? signal(shape.initial) : undefined;
      return RENDERERS[renderer](h(component(shape, authoring, server), { v, o: signal(shape.late === undefined) }));
    };
    for (const shape of SHAPES) {
      for (const authoring of ['h', 'compiled', 'spread']) {
        cases++;
        const mounted = await runClient(env, shape, component(shape, authoring, client));
        if (mounted) findings.push({ shape, path: `${authoring} mount`, ...mounted });
        for (const source of ['h:hydratable', 'h:stream', 'compiled:hydratable', 'spread:hydratable']) {
          cases++;
          const html = await markup(shape, source);
          const found = await runClient(env, shape, component(shape, authoring, hydratableClient), html);
          if (found) findings.push({ shape, path: `${authoring} hydrating ${source}`, html, ...found });
          if (!editsEarly(shape)) continue;
          cases++;
          const early = await runClient(env, shape, component(shape, authoring, hydratableClient), html, true);
          if (early) findings.push({ shape, path: `${authoring} hydrating ${source}, edited before`, html, ...early });
        }
      }
    }
    console.log(`form oracle: ${cases} client cases, ${findings.length} findings`);
    assert.equal(findings.length, 0, report(findings, cases));
  });
});
