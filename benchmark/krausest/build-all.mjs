#!/usr/bin/env node
// Build every framework implementation with vite (production, minified).
// Each framework gets its own dist/<name>/ directory served by bench.mjs.
//
// what resolves to the repo's packages/* sources (aliased) so the benchmark
// always measures the CURRENT tree, not a published version. react and
// Solid 1.9 come from this directory's isolated node_modules; Solid 2.0 comes
// from the frameworks/solid2 workspace (npm install here first). Each Solid
// major is compiled by its own compiler: Solid 1.9 by vite-plugin-solid
// (babel-preset-solid 1.9), Solid 2.0 by @solidjs/babel-plugin 2.0, the same
// Babel compiler Solid's official js-framework-benchmark entry uses. Both get
// omitNestedClosingTags, as in those official entries.
//
// Every build also writes dist/<name>/packages.json: the npm package (name and
// version) behind every module that contributed code to the emitted chunks,
// read from the bundler's own module graph. bench.mjs refuses to run a
// framework whose bundle does not contain the expected major version.

import { build } from 'vite';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const corePath = path.join(repo, 'packages/core/src/index.js');
const coreRenderPath = path.join(repo, 'packages/core/src/render.js');

const { default: what } = await import('what-compiler/vite');     // repo workspace
const { default: solid } = await import('vite-plugin-solid');     // local install

function solid2() {
  const require = createRequire(path.join(here, 'frameworks/solid2/package.json'));
  const babel = require('@babel/core');
  const compiler = require.resolve('@solidjs/babel-plugin');
  return {
    name: 'krausest-solid2-babel',
    enforce: 'pre',
    async transform(code, id) {
      if (!/\.jsx$/.test(id) || id.includes('/node_modules/')) return null;
      const out = await babel.transformAsync(code, {
        filename: id,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        plugins: [[compiler, { omitNestedClosingTags: true }]],
      });
      return { code: out.code, map: out.map };
    },
  };
}

function packageOf(file) {
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const pkgFile = path.join(dir, 'package.json');
    if (!existsSync(pkgFile)) continue;
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
    if (pkg.name && pkg.version) return { name: pkg.name, version: pkg.version, dir: path.relative(here, dir) || '.' };
  }
  return null;
}

function bundledPackages() {
  return {
    name: 'krausest-bundled-packages',
    generateBundle(_, bundle) {
      const packages = new Map();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, info] of Object.entries(chunk.modules)) {
          if (!info.renderedLength || id.startsWith('\0')) continue;
          const pkg = packageOf(id.split('?')[0]);
          if (!pkg) continue;
          const key = `${pkg.name}@${pkg.version}`;
          const entry = packages.get(key) ?? { ...pkg, renderedBytes: 0 };
          entry.renderedBytes += info.renderedLength;
          packages.set(key, entry);
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'packages.json',
        source: JSON.stringify([...packages.values()].sort((a, b) => a.name.localeCompare(b.name)), null, 2) + '\n',
      });
    },
  };
}

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
    plugins: [solid({ solid: { omitNestedClosingTags: true } })],
  },
  solid2: {
    plugins: [solid2()],
  },
};

const only = process.argv.slice(2);
for (const [name, extra] of Object.entries(targets)) {
  if (only.length && !only.includes(name)) continue;
  const outDir = path.join(here, 'dist', name);
  await build({
    configFile: false,
    root: path.join(here, 'frameworks', name),
    base: './',
    logLevel: 'warn',
    mode: 'production',
    ...extra,
    plugins: [...(extra.plugins ?? []), bundledPackages()],
    build: {
      outDir,
      emptyOutDir: true,
      minify: 'esbuild',
      target: 'es2022',
    },
  });
  console.log(`built ${name} -> dist/${name}/`);
}
