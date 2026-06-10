// Bundle the local What Framework runtime into self-contained ESM files that
// the preview iframe can load via an import map.
//
// Two entries are built with code splitting so they share ONE copy of the
// reactive core (signals/effects state must be a singleton):
//   public/vendor/what-framework.js         <- `what-framework`
//   public/vendor/what-framework-render.js  <- `what-framework/render`
//
// Built from the repo's packages (file: deps in package.json), so the
// playground always runs the same framework version as the compiler that
// produces the code it executes.

import { build } from 'esbuild';
import { rmSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'public/vendor');
const frameworkPkg = resolve(root, 'node_modules/what-framework');

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: {
    'what-framework': resolve(frameworkPkg, 'src/index.js'),
    'what-framework-render': resolve(frameworkPkg, 'src/render.js'),
  },
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir,
  entryNames: '[name]',
  chunkNames: 'chunk-[hash]',
  minify: true,
  sourcemap: false,
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

console.log('[playground] vendor framework bundle written to public/vendor/');
