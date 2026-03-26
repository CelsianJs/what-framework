#!/usr/bin/env node

// What Framework - Build Script
// Uses esbuild to produce proper ESM bundles per package.
// Outputs both .js (ESM) and .min.js (minified) with source maps.

import { build } from 'esbuild';
import { readFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

console.log('\n  Building What Framework with esbuild...\n');

// Package build configurations
// Each entry: { name, entries: [{ input, outputBase }], external }
const packages = [
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
  },
  {
    name: 'router',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
    ],
    external: ['what-core'],
  },
  {
    name: 'server',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
      { input: 'src/islands.js', outputBase: 'islands' },
      { input: 'src/actions.js', outputBase: 'actions' },
    ],
    external: ['what-core'],
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
    external: ['@babel/core', 'what-core', 'fs', 'path', 'url'],
  },
];

let totalOriginal = 0;
let totalMinified = 0;

for (const pkg of packages) {
  const pkgDir = join(root, 'packages', pkg.name);
  const distDir = join(pkgDir, 'dist');
  mkdirSync(distDir, { recursive: true });

  let pkgOriginal = 0;
  let pkgMinified = 0;

  for (const entry of pkg.entries) {
    const entryPath = join(pkgDir, entry.input);
    if (!existsSync(entryPath)) continue;

    const srcSize = statSync(entryPath).size;

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

      // Minified bundle
      await build({
        entryPoints: [entryPath],
        outfile: join(distDir, `${entry.outputBase}.min.js`),
        bundle: true,
        format: 'esm',
        platform: 'browser',
        sourcemap: true,
        treeShaking: true,
        external: pkg.external,
        minify: true,
        target: 'es2022',
        logLevel: 'silent',
      });

      const minPath = join(distDir, `${entry.outputBase}.min.js`);
      const minSize = existsSync(minPath) ? statSync(minPath).size : 0;

      pkgOriginal += srcSize;
      pkgMinified += minSize;
    } catch (err) {
      console.error(`  ERROR building ${pkg.name}/${entry.input}: ${err.message}`);
    }
  }

  totalOriginal += pkgOriginal;
  totalMinified += pkgMinified;

  const ratio = pkgOriginal > 0
    ? ((1 - pkgMinified / pkgOriginal) * 100).toFixed(0)
    : 0;
  console.log(
    `  @what/${pkg.name}  ${formatSize(pkgOriginal)} → ${formatSize(pkgMinified)} (${ratio}% reduction)`
  );
}

const totalRatio = totalOriginal > 0
  ? ((1 - totalMinified / totalOriginal) * 100).toFixed(0)
  : 0;
console.log(
  `\n  Total: ${formatSize(totalOriginal)} → ${formatSize(totalMinified)} (${totalRatio}% reduction)`
);
console.log('  Done!\n');

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' kB';
}
