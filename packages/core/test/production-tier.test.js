// The production tier drops development-only code entirely: not just the
// `if (__DEV__)` call sites, but the dev-only modules they alone reach, under
// every bundler What ships through. The fixture is a package laid out like
// what-core: the flag in src/env.js, re-exported by src/reactive.js, and a
// dev-only module (src/diag.js, with a catalogue) that two entries call only
// in development, so code splitting puts it in a shared chunk.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { PRODUCTION, buildBundlerTier } from '../../../scripts/build.js';
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

// The bundler tier (dist/*.js, the `module` condition) is what esbuild's
// default conditions resolve. Its checks read process.env.NODE_ENV in place,
// which esbuild defines as "production" when it minifies and "development"
// when it does not. The fixture sits where what-core does, so env.js is the
// module the tier rewrites.
describe('bundler tier: process.env.NODE_ENV decides', () => {
  let tier;
  const appBuild = async (minify) => {
    const app = join(root, 'tier-app.js');
    writeFileSync(app, "import { useThing } from './tier/hooks.js';\nimport { createThing } from './tier/store.js';\nconsole.log(useThing(1), createThing(2));\n");
    const result = await esbuild({ entryPoints: [app], bundle: true, minify, write: false, logLevel: 'silent' });
    return result.outputFiles[0].text;
  };

  before(async () => {
    const coreSrc = join(root, 'packages', 'core', 'src');
    cpSync(src, coreSrc, { recursive: true });
    tier = join(root, 'tier');
    await buildBundlerTier({
      entryPoints: ['env.js', 'reactive.js', 'diag.js', 'hooks.js', 'store.js'].map((f) => join(coreSrc, f)),
      bundle: true, splitting: true, format: 'esm', platform: 'browser', outdir: tier, logLevel: 'silent',
    });
  });

  it('spells every check, and the flag itself, as the NODE_ENV test', () => {
    const code = readAll(tier);
    assert.ok(code.includes('(process.env.NODE_ENV !== "production")'));
    assert.ok(!/__WHAT_DEV_|typeof __WHAT_DEV__|import\.meta/.test(code), 'the stand-in or runtime detection is left in the tier');
  });

  it('a minified esbuild build with default options drops the dev-only module', async () => {
    const code = await appBuild(true);
    assert.ok(code.includes('console.log'), 'the app was built');
    assert.ok(!code.includes(SENTINEL), 'the catalogue reached the production bundle');
    assert.ok(!code.includes('devSignals'), 'a dev branch reached the production bundle');
  });

  it('an unminified one keeps it', async () => {
    const code = await appBuild(false);
    assert.ok(code.includes(SENTINEL));
    assert.ok(code.includes('devSignals'));
  });
});
