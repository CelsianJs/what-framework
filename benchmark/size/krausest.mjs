// Recover attribution for existing sibling assets only when an isolated rebuild is byte-identical.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import what from 'what-compiler/vite';
import { measureBuild } from './attribute.mjs';
import { buildSettings, whatAliases } from './build.mjs';

export async function krausestBuilds(repo) {
  const dist = path.join(repo, 'benchmark/krausest/dist');
  if (!existsSync(dist)) return [];
  return (await readdir(dist)).sort()
    .filter(framework => existsSync(path.join(dist, framework, 'index.html')))
    .map(framework => ({ app: 'krausest', framework, outDir: path.join(dist, framework) }));
}

function solid2Plugin(root) {
  const require = createRequire(path.join(root, 'package.json'));
  const babel = require('@babel/core');
  const compiler = require.resolve('@solidjs/babel-plugin');
  return {
    name: 'size:krausest-solid2',
    enforce: 'pre',
    async transform(code, id) {
      if (!id.endsWith('.jsx') || id.includes('/node_modules/')) return;
      return babel.transformAsync(code, {
        filename: id,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        plugins: [[compiler, { omitNestedClosingTags: true }]],
      });
    },
  };
}

export async function krausestAttribution(build, actual, here, repo) {
  const { framework } = build;
  const packageLedger = path.join(build.outDir, 'packages.json');
  if (existsSync(packageLedger)) actual.runtimePackages = JSON.parse(await readFile(packageLedger, 'utf8'));
  if (!['what', 'solid2'].includes(framework) || actual.frameworkBytes !== null) return actual;

  const sibling = path.join(repo, 'benchmark/krausest');
  const root = path.join(sibling, 'frameworks', framework);
  const outDir = path.join(here, 'dist', 'krausest-attribution', framework);
  try {
    const require = createRequire(path.join(sibling, 'package.json'));
    const { build: viteBuild } = await import(pathToFileURL(require.resolve('vite')).href);
    const config = framework === 'what'
      ? { plugins: [what()], resolve: { alias: whatAliases(path.join(repo, 'packages/core/src')) } }
      : { plugins: [solid2Plugin(root)] };
    const output = await viteBuild({
      configFile: false,
      root,
      logLevel: 'silent',
      mode: 'production',
      base: './',
      ...config,
      build: { ...buildSettings, outDir, emptyOutDir: true },
    });
    const { result } = await measureBuild({
      ...build,
      outDir,
      chunks: output.output.filter(item => item.type === 'chunk'),
    }, repo);
    const assetHashes = row => row.assets.map(asset => asset.sha256).sort().join(',');
    if (assetHashes(actual) === assetHashes(result)) {
      const { modules, frameworkBytes, unmappedBytes } = result;
      return { ...actual, modules, frameworkBytes, unmappedBytes, attribution: 'byte-identical shadow rebuild' };
    }
    actual.attribution = 'shadow build differed from measured assets';
  } catch (error) {
    actual.attribution = `shadow build unavailable (${error.code ?? error.name})`;
  }
  return actual;
}
