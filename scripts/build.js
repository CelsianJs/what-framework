#!/usr/bin/env node

// What Framework - Build Script
// Uses esbuild to produce proper ESM bundles per package.
// Outputs both .js (ESM) and .min.js (minified) with source maps.

import { build } from 'esbuild';
import { readFileSync, mkdirSync, existsSync, statSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';

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
      { input: 'src/compiler.js', outputBase: 'compiler' },
      { input: 'src/devtools.js', outputBase: 'devtools' },
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
      { input: 'src/compiler.js', outputBase: 'compiler' },
    ],
    external: ['what-core', 'what-router', 'what-server', 'what-compiler'],
  },
  {
    name: 'devtools',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
      { input: 'src/DevPanel.jsx', outputBase: 'panel' },
    ],
    external: ['what-core'],
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

let totalBundle = 0;
let totalMinified = 0;
let totalGzip = 0;
let buildFailures = 0;

// Detailed per-entry data for the size report
const sizeReport = [];

for (const pkg of packages) {
  const pkgDir = join(root, 'packages', pkg.name);
  const distDir = join(pkgDir, 'dist');
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  let pkgBundle = 0;
  let pkgMinified = 0;
  let pkgGzip = 0;
  const entryResults = [];

  for (const entry of pkg.entries) {
    const entryPath = join(pkgDir, entry.input);
    if (!existsSync(entryPath)) {
      buildFailures += 1;
      console.error(`  ERROR missing configured entry ${pkg.name}/${entry.input}`);
      continue;
    }

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

      const bundlePath = join(distDir, `${entry.outputBase}.js`);
      const minPath = join(distDir, `${entry.outputBase}.min.js`);
      const bundleSize = existsSync(bundlePath) ? statSync(bundlePath).size : 0;
      const minSize = existsSync(minPath) ? statSync(minPath).size : 0;

      // Gzip the minified bundle for realistic transfer-size measurement
      let gzipSize = 0;
      if (existsSync(minPath)) {
        const minContent = readFileSync(minPath);
        gzipSize = gzipSync(minContent, { level: 9 }).length;
      }

      pkgBundle += bundleSize;
      pkgMinified += minSize;
      pkgGzip += gzipSize;

      entryResults.push({
        entry: entry.outputBase,
        bundle: bundleSize,
        min: minSize,
        gzip: gzipSize,
      });
    } catch (err) {
      buildFailures += 1;
      console.error(`  ERROR building ${pkg.name}/${entry.input}: ${err.message}`);
    }
  }

  totalBundle += pkgBundle;
  totalMinified += pkgMinified;
  totalGzip += pkgGzip;

  sizeReport.push({
    package: pkg.name,
    bundle: pkgBundle,
    min: pkgMinified,
    gzip: pkgGzip,
    entries: entryResults,
  });

  console.log(
    `  @what/${pkg.name}  bundle ${formatSize(pkgBundle)}  min ${formatSize(pkgMinified)}  gzip ${formatSize(pkgGzip)}`
  );
  // Show per-entry breakdown for packages with multiple entries
  if (entryResults.length > 1) {
    for (const e of entryResults) {
      console.log(
        `    ${e.entry.padEnd(20)} min ${formatSize(e.min).padStart(8)}  gzip ${formatSize(e.gzip).padStart(8)}`
      );
    }
  }
}

console.log(
  `\n  Total:  bundle ${formatSize(totalBundle)}  min ${formatSize(totalMinified)}  gzip ${formatSize(totalGzip)}`
);

// Write machine-readable size report (JSON)
const reportPath = join(root, 'size-report.json');
writeFileSync(reportPath, JSON.stringify({
  generated: new Date().toISOString(),
  packages: sizeReport,
  totals: { bundle: totalBundle, min: totalMinified, gzip: totalGzip },
}, null, 2) + '\n');
console.log(`  Size report: ${reportPath}`);
if (buildFailures > 0) {
  console.error(`  Build failed: ${buildFailures} entr${buildFailures === 1 ? 'y' : 'ies'} failed.`);
  process.exit(1);
}
console.log('  Done!\n');

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' kB';
}
