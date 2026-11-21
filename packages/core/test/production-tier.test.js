// The production tier drops development-only code entirely: not just the
// `if (__DEV__)` call sites, but the dev-only modules they alone reach, under
// every bundler What ships through. The fixture is a package laid out like
// what-core: the flag in src/env.js, re-exported by src/reactive.js, and a
// dev-only module (src/diag.js, with a catalogue) that two entries call only
// in development, so code splitting puts it in a shared chunk.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { PRODUCTION } from '../../../scripts/build.js';
import whatVitePlugin from '../../compiler/src/vite-plugin.js';

const SENTINEL = 'ERR_FIXTURE_CATALOGUE_ENTRY';
const envSource = readFileSync(fileURLToPath(new URL('../src/env.js', import.meta.url)), 'utf8');

let root, src, dist;

const readAll = (dir) => readdirSync(dir, { withFileTypes: true }).map((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? readAll(path) : entry.name.endsWith('.js') ? readFileSync(path, 'utf8') : '';
}).join('\n');

async function viteBuild(input, alias) {
  const { build } = await import('vite');
  const output = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    mode: 'production',
    plugins: [whatVitePlugin()],
    resolve: { alias },
    build: { write: false, minify: true, rollupOptions: { input } },
  });
  return (Array.isArray(output) ? output : [output]).flatMap((o) => o.output).map((o) => o.code ?? '').join('\n');
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'what-production-tier-'));
  src = join(root, 'packages', 'fixture', 'src');
  dist = join(root, 'packages', 'fixture', 'dist');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'env.js'), envSource);
  writeFileSync(join(src, 'reactive.js'), [
    "import { __DEV__ } from './env.js';",
    "export { __DEV__ } from './env.js';",
    'export function signal(v) { if (__DEV__) globalThis.devSignals = (globalThis.devSignals || 0) + 1; return v; }',
  ].join('\n'));
  writeFileSync(join(src, 'diag.js'), [
    `const CATALOGUE = { ${SENTINEL}: 'only development reports read this' };`,
    'export function report(code) { console.warn(CATALOGUE[code]); }',
  ].join('\n'));
  writeFileSync(join(src, 'hooks.js'), [
    "import { signal, __DEV__ } from './reactive.js';",
    "import { report } from './diag.js';",
    `export function useThing(v) { if (__DEV__) report('${SENTINEL}'); return signal(v) + 1; }`,
  ].join('\n'));
  writeFileSync(join(src, 'store.js'), [
    "import {",
    '  __DEV__,',
    "} from './env.js';",
    "import { report } from './diag.js';",
    `export function createThing(v) { if (__DEV__ && v < 0) report('${SENTINEL}'); return { v }; }`,
  ].join('\n'));
  writeFileSync(join(root, 'app.js'), "import { useThing } from 'fixture';\nimport { createThing } from 'fixture/store';\nconsole.log(useThing(1), createThing(2));\n");
});

after(() => rmSync(root, { recursive: true, force: true }));

describe('production tier: dev-only modules are dropped', () => {
  it('scripts/build.js (esbuild, split chunks) drops the dev-only module from every chunk', async () => {
    const options = {
      entryPoints: [join(src, 'hooks.js'), join(src, 'store.js')],
      bundle: true, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
      outdir: dist, entryNames: '[name].min', chunkNames: 'chunk-[hash].min', logLevel: 'silent',
    };
    await esbuild({ ...options, outdir: join(root, 'dev'), minify: false });
    assert.ok(readAll(join(root, 'dev')).includes(SENTINEL), 'the development build keeps the catalogue');
    await esbuild({ ...options, ...PRODUCTION, minify: true });
    const code = readAll(dist);
    assert.ok(!code.includes(SENTINEL), 'the catalogue reached a production chunk');
    assert.ok(!code.includes('devSignals'), 'a dev branch reached a production chunk');
    assert.ok(!/typeof __WHAT_DEV__|import\.meta|process/.test(code), 'runtime flag detection reached production');
  });

  it('what-compiler/vite drops it when the app resolves the source', async () => {
    const code = await viteBuild(join(root, 'app.js'), [
      { find: 'fixture/store', replacement: join(src, 'store.js') },
      { find: 'fixture', replacement: join(src, 'hooks.js') },
    ]);
    assert.ok(code.includes('console.log'), 'the app was built');
    assert.ok(!code.includes(SENTINEL));
    assert.ok(!code.includes('devSignals'));
  });

  it('what-compiler/vite drops it when the app resolves the production dist', async () => {
    const code = await viteBuild(join(root, 'app.js'), [
      { find: 'fixture/store', replacement: join(dist, 'store.min.js') },
      { find: 'fixture', replacement: join(dist, 'hooks.min.js') },
    ]);
    assert.ok(code.includes('console.log'), 'the app was built');
    assert.ok(!code.includes(SENTINEL));
  });
});
