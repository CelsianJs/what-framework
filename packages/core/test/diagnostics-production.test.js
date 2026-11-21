// A production build of a real app (hooks, a store, a form, an uncalled signal)
// carries none of the diagnostics channel: no catalogue text, no reported-only
// codes, no console pointer. Checked on the supported paths that build from
// source: esbuild with scripts/build.js's production config (how the published
// dist/*.min.js is made) and what-compiler/vite resolving the source. The dist
// itself is gated by `npm run test:prod`.
//
// Bundling What's source with esbuild and only a NODE_ENV define is not a
// supported production path (env.js cannot fold to a constant there); see
// docs/ERRORS.md "Production builds".

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { PRODUCTION } from '../../../scripts/build.js';
import whatVitePlugin from '../../compiler/src/vite-plugin.js';
import { ERROR_CODES } from '../src/errors.js';

const repo = fileURLToPath(new URL('../../..', import.meta.url));

const APP = `
import { createStore, useState, signal, h, mount } from 'what-framework';
import { useForm } from 'what-framework/form';
const state = createStore({ online: true })();
const name = signal('test', 'name');
const count = signal(0, 'count');
function Example() {
  const form = useForm({ defaultValues: { name: 'todo' } });
  const [n, inc] = useState(0);
  return h('section', {}, h('p', {}, \`Title: \${name}\`), h('p', {}, () => state.online), h('input', form.register('name')), h('button', { onClick: () => inc(1) }, n), h('p', {}, () => count()));
}
mount(h(Example, {}), document.getElementById('app'));
`;

// Text that exists only for development reports.
const DEV_ONLY = [
  ...Object.values(ERROR_CODES).map((def) => def.suggestion.slice(0, 40)),
  ...Object.values(ERROR_CODES).map((def) => def.template.replace(/\{\{\w+\}\}.*/, '').slice(0, 30)).filter((t) => t.length >= 20),
  'what_fix(',
  'skills/what-diagnostics',
  'ERR_MISSING_SIGNAL_READ',
  'ERR_CONTEXT_NOT_PROVIDED',
  'ERR_FORM_HANDLER_WITHOUT_EVENT',
  '__what_mcp_discovery',
];

function leaks(code) {
  return DEV_ONLY.filter((text) => code.includes(text));
}

let root;
before(() => {
  root = mkdtempSync(join(tmpdir(), 'what-diagnostics-production-'));
  writeFileSync(join(root, 'main.js'), APP);
  writeFileSync(join(root, 'index.html'), '<!doctype html><div id="app"></div><script type="module" src="./main.js"></script>');
});
after(() => rmSync(root, { recursive: true, force: true }));

describe('production builds carry no diagnostics', () => {
  it('esbuild with the production config scripts/build.js uses for dist/*.min.js', async () => {
    const out = await esbuild({
      stdin: { contents: APP, resolveDir: repo, loader: 'js' },
      bundle: true, minify: true, format: 'esm', write: false, logLevel: 'silent',
      ...PRODUCTION,
    });
    const code = out.outputFiles[0].text;
    assert.deepEqual(leaks(code), [], `${code.length} B bundle`);
  });

  it('what-compiler/vite resolving the source', async () => {
    const { build } = await import('vite');
    const output = await build({
      configFile: false,
      root,
      logLevel: 'silent',
      mode: 'production',
      plugins: [whatVitePlugin({ prodBundles: false })],
      resolve: {
        alias: [
          { find: /^what-framework$/, replacement: join(repo, 'packages/what/src/index.js') },
          { find: /^what-framework\/form$/, replacement: join(repo, 'packages/what/src/form.js') },
        ],
      },
      build: { write: false, minify: true },
    });
    const code = (Array.isArray(output) ? output : [output]).flatMap((o) => o.output).map((o) => o.code ?? '').join('\n');
    assert.ok(code.includes('createElement') || code.length > 1000, 'the app was bundled');
    assert.deepEqual(leaks(code), [], `${code.length} B bundle`);
  });
});
