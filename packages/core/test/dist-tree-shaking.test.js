// An app bundled from the production dist is the app bundled from the source:
// same code kept, same bytes within noise. The dist is built here with
// scripts/build.js's own buildModules into a temporary package, so the test
// needs no prior `npm run build`. scripts/check-size.mjs measures the same
// property under Rollup and Rolldown on the real dist.
//
// The vnode renderer is the case this guards: compiled JSX builds DOM directly,
// so a compiled app with no h(), boundary or portal must not carry createDOM,
// and an app that does use h() must.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { transformSync } from '@babel/core';
import whatBabelPlugin from '../../compiler/src/babel-plugin.js';
import { buildModules, PRODUCTION } from '../../../scripts/build.js';

const CORE = fileURLToPath(new URL('..', import.meta.url));
// '__portal' is the vnode renderer's portal branch (dom.js createDOM); 'focusin'
// is the listener a11y.js used to register at startup.
const RENDERER = '__portal';
const FOCUS_LISTENER = 'focusin';

const compiledCounter = transformSync(`
import { mount, signal } from 'what-framework';
function App() {
  const count = signal(0);
  return (
    <main>
      <button onClick={() => count(c => c - 1)}>-</button>
      <output>{count()}</output>
      <button onClick={() => count(c => c + 1)}>+</button>
    </main>
  );
}
mount(<App />, '#app');
`, {
  filename: 'counter.jsx',
  configFile: false,
  babelrc: false,
  plugins: [[whatBabelPlugin, { production: true }]],
  parserOpts: { plugins: ['jsx'] },
}).code;

const hCounter = `
import { h, mount, signal } from 'what-framework';
const count = signal(0);
mount(h('button', { onclick: () => count(c => c + 1) }, () => count()), '#app');
`;

let tmp;
let dist;

before(async () => {
  // The real path: on macOS the temp dir is a symlink, and a module reached
  // through both spellings would be bundled twice.
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'what-dist-')));
  const pkg = join(tmp, 'what-core');
  dist = join(pkg, 'dist');
  await buildModules(CORE, dist);
  // What a bundler reads from the published package: the modules have no side effects.
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'what-core', type: 'module', sideEffects: false }));
});

after(() => rmSync(tmp, { recursive: true, force: true }));

async function bundle(source, from) {
  const file = (sub) => (from === 'dist' ? join(dist, `${sub}.min.js`) : join(CORE, 'src', `${sub}.js`));
  const result = await build({
    stdin: { contents: source, resolveDir: CORE, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    ...(from === 'source' ? PRODUCTION : {}),
    plugins: [
      { name: 'what', setup(b) { b.onResolve({ filter: /^what-framework(\/render)?$/ }, (args) => ({ path: file(args.path.endsWith('/render') ? 'render' : 'index') })); } },
      ...(from === 'source' ? PRODUCTION.plugins : []),
    ],
  });
  return result.outputFiles[0].text;
}

const gzip = (code) => gzipSync(code, { level: 9 }).length;

describe('production dist tree-shaking', () => {
  it('a compiled app carries neither the vnode renderer nor a startup focus listener', async () => {
    const code = await bundle(compiledCounter, 'dist');
    assert.ok(!code.includes(RENDERER), 'the vnode renderer reached a compiled-only app');
    assert.ok(!code.includes(FOCUS_LISTENER), 'a module-scope focus listener reached a compiled-only app');
  });

  it('an app that calls h() gets the renderer, from the dist as from the source', async () => {
    assert.ok((await bundle(hCounter, 'dist')).includes(RENDERER));
    assert.ok((await bundle(hCounter, 'source')).includes(RENDERER));
  });

  for (const [name, source] of [['compiled counter', compiledCounter], ['h() counter', hCounter]]) {
    it(`the ${name} is within 2% of its from-source size`, async () => {
      const fromDist = gzip(await bundle(source, 'dist'));
      const fromSource = gzip(await bundle(source, 'source'));
      const drift = Math.abs(fromDist - fromSource) / fromSource;
      assert.ok(drift <= 0.02, `dist ${fromDist} B vs source ${fromSource} B gzip (${(drift * 100).toFixed(1)}%)`);
    });
  }
});
