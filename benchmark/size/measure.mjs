// Build and smoke-test matched production apps before reporting shipped JS and composition.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditRegions, explainExport } from './audit.mjs';
import { listExports, measureBuild } from './attribute.mjs';
import { buildApp } from './build.mjs';
import { krausestAttribution, krausestBuilds } from './krausest.mjs';
import { writeReport } from './report.mjs';
import { smoke } from './smoke.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const apps = ['hello', 'todo'];
const frameworks = ['what', 'solid1', 'solid2', 'react'];
process.env.NODE_ENV = 'production';

async function packageVersion(dir, name) {
  return JSON.parse(await readFile(path.join(dir, name, 'package.json'), 'utf8')).version;
}

const packages = [
  'solid1', 'solid-js', '@solidjs/web', '@solidjs/signals', 'react', 'react-dom',
  'vite', 'esbuild', 'rollup', '@babel/core', 'babel-preset-solid', '@solidjs/babel-plugin',
];
const tools = Object.fromEntries(await Promise.all(packages.map(async name => [
  name, await packageVersion(path.join(here, 'node_modules'), name),
])));
tools.playwright = await packageVersion(path.join(repo, 'node_modules'), 'playwright');
tools['what-compiler'] = await packageVersion(path.join(repo, 'node_modules'), 'what-compiler');

function checkSolidOutput(row) {
  const paths = new Set(row.modules.filter(module => module.minifiedBytes).map(module => module.source));
  const local = 'benchmark/size/node_modules/';
  const solid1Paths = ['solid1/dist/solid.js', 'solid1/web/dist/web.js'];
  const solid2Paths = ['solid-js/dist/solid.js', '@solidjs/web/dist/web.js', '@solidjs/signals/dist/prod/signals.js'];
  const [expected, unexpected] = row.framework === 'solid1'
    ? [solid1Paths, solid2Paths]
    : [solid2Paths, solid1Paths];
  for (const source of expected) assert(paths.has(local + source), `Missing ${source}`);
  for (const source of unexpected) assert(!paths.has(local + source), `Unexpected ${source}`);
  row.runtimeEvidence = expected.map(source => local + source);
}

assert.equal(tools.solid1, '1.9.20');
assert.equal(tools['solid-js'], '2.0.3');
assert.equal(tools['@solidjs/web'], '2.0.3');

const builds = [];
for (const app of apps) {
  for (const framework of frameworks) {
    builds.push({ app, framework, ...await buildApp(here, repo, app, framework) });
  }
}
builds.push(...await krausestBuilds(repo));
tools.chromium = await smoke(builds);
const results = [];
for (const build of builds) {
  const { sources, result } = await measureBuild(build, repo);
  if (build.chunks && ['solid1', 'solid2'].includes(result.framework)) checkSolidOutput(result);
  if (result.app === 'hello' && result.framework === 'what') {
    const exports = await listExports(repo, sources, result.modules);
    result.runtimeExports = exports.map(row => ({ ...row, reason: explainExport(row) }));
  }
  if (result.framework === 'what' && sources.size) result.regions = auditRegions(sources);
  results.push(result.app === 'krausest' ? await krausestAttribution(build, result, here, repo) : result);
}

function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}
const report = {
  machine: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0].model },
  toolchain: { node: process.version, npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(), zlib: process.versions.zlib, brotli: process.versions.brotli, ...tools },
  whatRevision: git('rev-parse', 'HEAD'),
  whatSourceChanges: git('status', '--short', '--', 'packages/core', 'packages/compiler'),
  results,
};

await writeReport(here, report);
await writeFile(path.join(here, 'results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Smoke passed for ${builds.length} bundles. Wrote RESULTS.md and results.json.`);
