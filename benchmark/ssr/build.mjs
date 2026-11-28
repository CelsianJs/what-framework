#!/usr/bin/env node
// Bundle every framework's server entry for Node, each JSX compiled by that
// framework's own compiler in its own server mode:
//
//   what    esbuild automatic JSX runtime, jsxImportSource "what-framework"
//           (h() vnodes, rendered by what-server's vnode renderer).
//   whatc   what-compiler { generate: "ssr" } (string templates rendered by
//           what-server/ssr-runtime). Both What entries resolve what-framework
//           through the repo root's workspace symlinks to packages/*/src: the
//           WORKING TREE.
//   react   esbuild automatic JSX runtime, jsxImportSource "react".
//   solid1  babel-preset-solid      { generate: "ssr", hydratable }
//   solid2  @solidjs/babel-plugin   { generate: "ssr", hydratable }
//
// Each framework is bundled twice, as a "plain" and a "hydratable" bundle, to
// dist/<framework>.<mode>.mjs. Production everywhere: NODE_ENV=production and
// no "development" export condition. dist/manifest.json records, from the
// esbuild metafile, the exact package versions that went into each bundle.
//
// Usage: node build.mjs

import { build } from 'esbuild';
import { transformAsync } from '@babel/core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const distDir = path.join(here, 'dist');

function requireFrom(dir) {
  return createRequire(path.join(here, dir, 'package.json'));
}

const solidPresetV1 = requireFrom('frameworks/solid1')('babel-preset-solid');
const { default: whatCompiler } = await import(path.join(repo, 'packages/compiler/src/babel-plugin.js'));
const solidPluginV2 = requireFrom('frameworks/solid2')('@solidjs/babel-plugin');

function babelJsx(babelOptions) {
  return {
    name: 'babel-jsx',
    setup(b) {
      b.onLoad({ filter: /\.jsx$/ }, async (args) => {
        const source = await readFile(args.path, 'utf8');
        const out = await transformAsync(source, {
          filename: args.path,
          babelrc: false,
          configFile: false,
          sourceMaps: false,
          ...babelOptions,
        });
        return { contents: out.code, loader: 'js' };
      });
    },
  };
}

const FRAMEWORKS = {
  what: (hydratable) => ({ jsx: 'automatic', jsxImportSource: 'what-framework', define: { __HYDRATABLE__: String(hydratable) } }),
  whatc: (hydratable) => ({
    plugins: [babelJsx({ parserOpts: { plugins: ['jsx'] }, plugins: [[whatCompiler, { generate: 'ssr', production: true }]] })],
    define: { __HYDRATABLE__: String(hydratable) },
  }),
  react: (hydratable) => ({ jsx: 'automatic', jsxImportSource: 'react', define: { __HYDRATABLE__: String(hydratable) } }),
  solid1: (hydratable) => ({ plugins: [babelJsx({ presets: [[solidPresetV1, { generate: 'ssr', hydratable }]] })] }),
  solid2: (hydratable) => ({ plugins: [babelJsx({ plugins: [[solidPluginV2.default ?? solidPluginV2, { generate: 'ssr', hydratable }]] })] }),
};

const MODES = ['plain', 'hydratable'];

// Package name + version for every node_modules package in a bundle.
async function packagesIn(metafile) {
  const found = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const m = input.match(/^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//);
    if (!m || found.has(m[1])) continue;
    const pkg = JSON.parse(await readFile(path.join(here, m[1], 'package.json'), 'utf8'));
    found.set(m[1], { name: pkg.name, version: pkg.version, path: path.relative(here, m[1]) });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function repoSources(metafile) {
  return Object.keys(metafile.inputs)
    .map((p) => path.relative(repo, path.resolve(here, p)))
    .filter((p) => p.startsWith('packages/'))
    .sort();
}

function git(cmd) {
  try { return execSync(`git ${cmd}`, { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; }
}

await mkdir(distDir, { recursive: true });
const manifest = { builtAt: new Date().toISOString(), bundles: {} };

for (const [framework, options] of Object.entries(FRAMEWORKS)) {
  for (const mode of MODES) {
    const outfile = path.join(distDir, `${framework}.${mode}.mjs`);
    const extra = options(mode === 'hydratable');
    const result = await build({
      entryPoints: [path.join(here, 'frameworks', framework, 'entry.jsx')],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      minify: false,
      metafile: true,
      logLevel: 'warning',
      absWorkingDir: here,
      // react-dom/server is CommonJS and require()s Node builtins.
      banner: { js: "import { createRequire as __ssrBenchCreateRequire } from 'node:module'; const require = __ssrBenchCreateRequire(import.meta.url);" },
      ...extra,
      define: { 'process.env.NODE_ENV': '"production"', ...extra.define },
    });
    const entry = { file: path.relative(here, outfile), packages: await packagesIn(result.metafile) };
    if (framework === 'what' || framework === 'whatc') {
      const sources = repoSources(result.metafile);
      const dirty = git(`status --porcelain -- ${sources.map((s) => `'${s}'`).join(' ')}`);
      entry.repoSources = sources.length;
      entry.git = { commit: git('rev-parse --short HEAD'), dirtyFiles: dirty ? dirty.split('\n').length : 0 };
    }
    manifest.bundles[`${framework}.${mode}`] = entry;
    console.log(`built ${framework}.${mode} -> ${entry.file}`);
  }
}

await writeFile(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
