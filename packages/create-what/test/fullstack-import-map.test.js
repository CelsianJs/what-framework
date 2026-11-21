// The --fullstack scaffold is buildless: the browser loads the framework as
// native ES modules through the import map server.js renders. These tests boot
// server.js (no npm install, no network) and check that the map names every
// subpath the framework packages export, and that a page importing any of them
// loads: each mapped module, and everything it imports in turn, is resolved
// the way the browser resolves it (bare specifiers through the map, relative
// ones against the module's URL) and fetched from the server.
//
// Two layouts: packages hoisted into the app's node_modules, and the layout a
// package manager that does not hoist produces (pnpm), where what-core,
// what-router and what-server sit only next to what-framework.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';

const repoRoot = resolve(import.meta.dirname, '../../..');
const createWhat = resolve(repoRoot, 'packages/create-what/index.js');

// The first port from 57140 that nothing listens on (server.js reads PORT and
// cannot be given port 0).
async function freePort() {
  for (let port = 57140; port < 57200; port++) {
    const free = await new Promise((done) => {
      const probe = createServer().once('error', () => done(false)).listen(port, () => probe.close(() => done(true)));
    });
    if (free) return port;
  }
  assert.fail('no free port in 57140-57199');
}

const FRAMEWORK = { 'what-framework': 'packages/what', 'what-core': 'packages/core', 'what-router': 'packages/router', 'what-server': 'packages/server' };

function scaffold(workDir, name) {
  const out = spawnSync(process.execPath, [createWhat, name, '--fullstack', '--yes'], { cwd: workDir, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return join(workDir, name);
}

async function link(appDir, name, target) {
  await mkdir(join(appDir, 'node_modules'), { recursive: true });
  await symlink(target, join(appDir, 'node_modules', name), 'dir');
}

async function boot(appDir, { env = {} } = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: appDir,
    env: { ...process.env, PORT: String(port), NODE_ENV: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.logs = '';
  child.stdout.on('data', (d) => { child.logs += d; });
  child.stderr.on('data', (d) => { child.logs += d; });
  const base = `http://localhost:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) assert.fail(`server.js exited (${child.exitCode}):\n${child.logs}`);
    try {
      if ((await fetch(base + '/')).ok) return { child, base };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill('SIGTERM');
  assert.fail(`server.js did not answer on :${port}:\n${child.logs}`);
}

async function stop(child) {
  child.kill('SIGTERM');
  await new Promise((r) => { child.on('exit', r); setTimeout(r, 2000); });
}

async function pageImportMap(base) {
  const html = await (await fetch(base + '/')).text();
  return JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/)[1]).imports;
}

// Every subpath a package exports for the browser, read from its package.json.
function exportedSpecifiers(name) {
  const { exports } = JSON.parse(readFileSync(join(repoRoot, FRAMEWORK[name], 'package.json'), 'utf8'));
  return Object.keys(exports).map((subpath) => name + subpath.slice(1));
}

// Load every mapped module the way a browser does, through the map and over
// HTTP, following static and dynamic imports. A bare specifier missing from
// the map, or a module the server does not serve, fails the build.
async function loadThroughMap(base, imports) {
  const entry = Object.keys(imports).map((specifier, i) => `export * as m${i} from ${JSON.stringify(specifier)};`).join('\n');
  const result = await build({
    stdin: { contents: entry, loader: 'js' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
    metafile: true,
    plugins: [{
      name: 'browser-import-map',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (Object.hasOwn(imports, args.path)) return { path: new URL(imports[args.path], base).href, namespace: 'http' };
          if (args.namespace === 'http' && /^\.\.?\//.test(args.path)) return { path: new URL(args.path, args.importer).href, namespace: 'http' };
          return { errors: [{ text: `"${args.path}" (imported by ${args.importer || 'the page'}) is not in the import map` }] };
        });
        b.onLoad({ filter: /.*/, namespace: 'http' }, async (args) => {
          const res = await fetch(args.path);
          if (!res.ok) return { errors: [{ text: `${args.path} answered ${res.status}` }] };
          return { contents: await res.text(), loader: args.path.endsWith('.jsx') ? 'jsx' : 'js' };
        });
      },
    }],
  }).catch((err) => assert.fail(err.errors.map((e) => e.text).join('\n')));
  return Object.keys(result.metafile.inputs).map((input) => input.replace(/^http:/, ''));
}

test('fullstack import map: every exported subpath is mapped, served, and loads with what it imports', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'create-what-importmap-'));
  const appDir = scaffold(workDir, 'map-app');
  for (const [name, dir] of Object.entries({ ...FRAMEWORK, 'what-isr': 'packages/cache', 'what-devtools': 'packages/devtools', 'what-devtools-mcp': 'packages/devtools-mcp' })) {
    await link(appDir, name, resolve(repoRoot, dir));
  }
  const { child, base } = await boot(appDir);
  try {
    const imports = await pageImportMap(base);
    for (const name of Object.keys(FRAMEWORK)) {
      for (const specifier of exportedSpecifiers(name)) assert.ok(imports[specifier], `the map names ${specifier}`);
    }
    for (const specifier of ['what-devtools', 'what-devtools-mcp/client']) assert.ok(imports[specifier], `development maps ${specifier}`);

    const loaded = await loadThroughMap(base, imports);
    assert.ok(loaded.includes(new URL(imports['what-framework/router'], base).href), 'what-framework/router loaded');
    assert.ok(loaded.some((url) => url.endsWith('/node_modules/what-router/src/index.js')), 'and the router it re-exports');
  } finally {
    await stop(child);
    await rm(workDir, { recursive: true, force: true });
  }
});

test('fullstack import map: packages a package manager did not hoist are found, served and published', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'create-what-importmap-pnpm-'));
  const appDir = scaffold(workDir, 'pnpm-app');
  // pnpm's layout: the app's node_modules links only its own dependencies, and
  // what-framework's dependencies sit next to it in the store.
  const store = join(appDir, 'node_modules', '.pnpm', 'what-framework', 'node_modules');
  for (const [name, dir] of Object.entries(FRAMEWORK)) {
    for (const entry of ['package.json', 'src']) cpSync(join(repoRoot, dir, entry), join(store, name, entry), { recursive: true });
  }
  await link(appDir, 'what-framework', join(store, 'what-framework'));
  for (const [name, dir] of Object.entries({ 'what-isr': 'packages/cache', esbuild: 'node_modules/esbuild' })) {
    await link(appDir, name, resolve(repoRoot, dir));
  }
  assert.equal(existsSync(join(appDir, 'node_modules', 'what-core')), false, 'what-core is not hoisted');

  const { child, base } = await boot(appDir, { env: { NODE_ENV: 'production', WHAT_REVALIDATE_SECRET: 'import-map-test' } });
  try {
    const imports = await pageImportMap(base);
    assert.equal(imports['what-core'], '/node_modules/what-core/src/index.js');
    const served = await (await fetch(base + imports['what-core'])).text();
    assert.equal(served, readFileSync(join(store, 'what-core', 'src', 'index.js'), 'utf8'), 'served from next to what-framework');
    await loadThroughMap(base, imports);
  } finally {
    await stop(child);
  }

  try {
    const out = spawnSync(process.execPath, ['build.js'], { cwd: appDir, encoding: 'utf8' });
    assert.equal(out.status, 0, `build failed:\n${out.stdout}\n${out.stderr}`);
    const { imports } = JSON.parse(readFileSync(join(appDir, 'import-map.json'), 'utf8'));
    for (const [specifier, url] of Object.entries(imports)) {
      assert.ok(existsSync(join(appDir, 'dist', 'static', url)), `${specifier} -> dist/static${url} is published`);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
