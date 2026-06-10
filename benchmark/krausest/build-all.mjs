#!/usr/bin/env node
// Build every framework implementation with vite (production, minified).
// Each framework gets its own dist/<name>/ directory served by bench.mjs.
//
// what resolves to the repo's packages/* sources (aliased) so the benchmark
// always measures the CURRENT tree, not a published version. react/solid come
// from this directory's isolated node_modules (npm install here first).

import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const corePath = path.join(repo, 'packages/core/src/index.js');
const coreRenderPath = path.join(repo, 'packages/core/src/render.js');

const { default: what } = await import('what-compiler/vite');     // repo workspace
const { default: solid } = await import('vite-plugin-solid');     // local install

const targets = {
  vanilla: {},
  what: {
    plugins: [what()],
    resolve: {
      alias: [
        { find: 'what-framework/render', replacement: coreRenderPath },
        { find: 'what-core/render', replacement: coreRenderPath },
        { find: 'what-framework', replacement: corePath },
        { find: 'what-core', replacement: corePath },
      ],
    },
  },
  react: {
    esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  },
  solid: {
    plugins: [solid()],
  },
};

const only = process.argv.slice(2);
for (const [name, extra] of Object.entries(targets)) {
  if (only.length && !only.includes(name)) continue;
  await build({
    configFile: false,
    root: path.join(here, 'frameworks', name),
    base: './',
    logLevel: 'warn',
    mode: 'production',
    ...extra,
    build: {
      outDir: path.join(here, 'dist', name),
      emptyOutDir: true,
      minify: 'esbuild',
      target: 'es2022',
    },
  });
  console.log(`built ${name} -> dist/${name}/`);
}
