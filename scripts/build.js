#!/usr/bin/env node

// What Framework - Build Script
// Uses esbuild to produce proper ESM bundles per package.
// Outputs both .js (ESM) and .min.js (minified) with source maps.

import { build } from 'esbuild';
import { mkdirSync, existsSync, statSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

// Package build configurations
// Each entry: { name, entries: [{ input, outputBase }], external }
// Exported so scripts/check-publish-surface.mjs can derive the per-package
// dist allowlist from the same source of truth.
export const packages = [
  {
    name: 'core',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
      { input: 'src/render.js', outputBase: 'render' },
      { input: 'src/jsx-runtime.js', outputBase: 'jsx-runtime' },
      { input: 'src/jsx-dev-runtime.js', outputBase: 'jsx-dev-runtime' },
      { input: 'src/testing.js', outputBase: 'testing' },
    ],
    external: [],
    // CRITICAL: build all entries together with code-splitting so shared
    // stateful modules (dom.js's componentStack, reactive.js's tracking
    // context) become ONE shared chunk imported by every entry. Without this,
    // esbuild inlines a separate copy of dom.js/reactive.js into index.min.js
    // and render.min.js, producing two component stacks — `useSignal` reads one
    // while the compiler's `_$createComponent` pushes the other, blanking every
    // production build. See AUDIT-2026-06-06.md C1.
    split: true,
  },
  {
    name: 'router',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
      // what-router/match is a public subpath (exports map references
      // dist/match.min.js) consumed by what-server's deploy adapters — it
      // MUST be built or `--conditions=production` resolution dangles.
      { input: 'src/match.js', outputBase: 'match' },
    ],
    external: ['what-core'],
  },
  {
    name: 'server',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
      { input: 'src/node.js', outputBase: 'node' },
      { input: 'src/islands.js', outputBase: 'islands' },
      { input: 'src/actions.js', outputBase: 'actions' },
    ],
    // what-router/what-isr are optional peers (kept external, not inlined); the
    // deploy adapters lazy-import Node builtins which must not be bundled.
    external: ['what-core', 'what-router', 'what-router/match', 'what-isr', 'node:async_hooks', 'node:fs/promises', 'node:http', 'node:path'],
  },
  {
    // Origin-first ISR engine. Zero runtime deps; Node-only builtins stay external.
    name: 'cache',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
    ],
    external: ['node:crypto', 'node:fs/promises', 'node:path'],
  },
  {
    name: 'what',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
      { input: 'src/render.js', outputBase: 'render' },
      { input: 'src/router.js', outputBase: 'router' },
      { input: 'src/server.js', outputBase: 'server' },
      { input: 'src/jsx-runtime.js', outputBase: 'jsx-runtime' },
      { input: 'src/jsx-dev-runtime.js', outputBase: 'jsx-dev-runtime' },
      { input: 'src/testing.js', outputBase: 'testing' },
    ],
    external: ['what-core', 'what-router', 'what-server', 'what-compiler'],
  },
  {
    name: 'compiler',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
      { input: 'src/babel-plugin.js', outputBase: 'babel-plugin' },
      { input: 'src/vite-plugin.js', outputBase: 'vite-plugin' },
      { input: 'src/runtime.js', outputBase: 'runtime' },
      { input: 'src/file-router.js', outputBase: 'file-router' },
    ],
    // 'vite' is the host tool — the vite-plugin's dynamic import('vite')
    // (version detection) must stay external or esbuild drags all of
    // vite+esbuild into the bundle and these entries fail to build.
    external: ['@babel/core', 'what-core', 'vite', 'fs', 'path', 'url'],
  },
];

async function runBuild() {
console.log('\n  Building What Framework with esbuild...\n');

let totalBundle = 0;
let totalMinified = 0;

for (const pkg of packages) {
  const pkgDir = join(root, 'packages', pkg.name);
  const distDir = join(pkgDir, 'dist');
  // Clean before every build so dist/ is reproducible — stale chunk-<hash>
  // generations and orphaned entries must never accumulate (and never ship).
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  let pkgBundle = 0;
  let pkgMinified = 0;

  if (pkg.split) {
    // Build every entry in ONE esbuild call with splitting so shared internal
    // modules are emitted as a single shared chunk (one runtime instance).
    const entryPoints = pkg.entries
      .map((e) => join(pkgDir, e.input))
      .filter((p) => existsSync(p));
    try {
      const common = {
        entryPoints,
        bundle: true,
        format: 'esm',
        platform: 'browser',
        splitting: true,
        sourcemap: true,
        treeShaking: true,
        external: pkg.external,
        target: 'es2022',
        logLevel: 'silent',
        outdir: distDir,
      };
      // Readable bundle: dist/<name>.js + shared chunk-<hash>.js
      await build({ ...common, minify: false, entryNames: '[name]', chunkNames: 'chunk-[hash]' });
      // Minified bundle: dist/<name>.min.js + shared chunk-<hash>.min.js
      // sourcemap 'external': emit .map locally but no sourceMappingURL comment —
      // only *.min.js ships to npm (package.json `files`), so a linked map would
      // be a dangling 404 for CDN consumers.
      await build({ ...common, minify: true, sourcemap: 'external', entryNames: '[name].min', chunkNames: 'chunk-[hash].min' });

      for (const entry of pkg.entries) {
        const bundlePath = join(distDir, `${entry.outputBase}.js`);
        const minPath = join(distDir, `${entry.outputBase}.min.js`);
        pkgBundle += existsSync(bundlePath) ? statSync(bundlePath).size : 0;
        pkgMinified += existsSync(minPath) ? statSync(minPath).size : 0;
      }
    } catch (err) {
      console.error(`  ERROR building ${pkg.name} (split): ${err.message}`);
    }

    totalBundle += pkgBundle;
    totalMinified += pkgMinified;
    const ratio = pkgBundle > 0 ? ((1 - pkgMinified / pkgBundle) * 100).toFixed(0) : 0;
    console.log(
      `  @what/${pkg.name}  bundle ${formatSize(pkgBundle)}  min ${formatSize(pkgMinified)}  (${ratio}% minification, split)`
    );
    continue;
  }

  for (const entry of pkg.entries) {
    const entryPath = join(pkgDir, entry.input);
    if (!existsSync(entryPath)) continue;

    try {
      // ESM bundle (readable, with source map)
      await build({
        entryPoints: [entryPath],
        outfile: join(distDir, `${entry.outputBase}.js`),
        bundle: true,
        format: 'esm',
        platform: 'browser',
        sourcemap: true,
        treeShaking: true,
        external: pkg.external,
        // Keep readable for debugging
        minify: false,
        target: 'es2022',
        logLevel: 'silent',
      });

      // Minified bundle (map emitted locally, but without a sourceMappingURL
      // comment — maps are excluded from the npm payload)
      await build({
        entryPoints: [entryPath],
        outfile: join(distDir, `${entry.outputBase}.min.js`),
        bundle: true,
        format: 'esm',
        platform: 'browser',
        sourcemap: 'external',
        treeShaking: true,
        external: pkg.external,
        minify: true,
        target: 'es2022',
        logLevel: 'silent',
      });

      const bundlePath = join(distDir, `${entry.outputBase}.js`);
      const minPath = join(distDir, `${entry.outputBase}.min.js`);
      const bundleSize = existsSync(bundlePath) ? statSync(bundlePath).size : 0;
      const minSize = existsSync(minPath) ? statSync(minPath).size : 0;

      pkgBundle += bundleSize;
      pkgMinified += minSize;
    } catch (err) {
      console.error(`  ERROR building ${pkg.name}/${entry.input}: ${err.message}`);
    }
  }

  totalBundle += pkgBundle;
  totalMinified += pkgMinified;

  const ratio = pkgBundle > 0
    ? ((1 - pkgMinified / pkgBundle) * 100).toFixed(0)
    : 0;
  console.log(
    `  @what/${pkg.name}  bundle ${formatSize(pkgBundle)}  min ${formatSize(pkgMinified)}  (${ratio}% minification)`
  );
}

const totalRatio = totalBundle > 0
  ? ((1 - totalMinified / totalBundle) * 100).toFixed(0)
  : 0;
console.log(
  `\n  Total:  bundle ${formatSize(totalBundle)}  min ${formatSize(totalMinified)}  (${totalRatio}% minification)`
);
console.log('  Done!\n');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' kB';
}

// Only build when executed directly (`node scripts/build.js`) — importing this
// module (e.g. from check-publish-surface.mjs) must be side-effect free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runBuild();
}
