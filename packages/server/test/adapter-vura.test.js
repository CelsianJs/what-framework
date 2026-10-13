// Vura adapter: createVuraHandler + buildVuraOutput.
//
// The deploy contract this guards (vura-platform is the consumer):
//   - dist/manifest.json is a v1 manifest the published @celsian/vura-contract
//     accepts, with requiredFeatures derived exactly as the contract derives them
//   - ONE catch-all serverless Function at '/*' whose code is at
//     dist/functions/_/index.js (module name derived from the url pattern the
//     way the platform derives it) next to a {"type":"module"} package.json
//   - the bundle is self-contained: it runs from a directory with no
//     node_modules anywhere above it
//   - dist/static/** holds the browser files at their URL paths
//   - the handler sees the PUBLIC origin (x-forwarded-host/proto), not the
//     platform's internal URL, and request bodies survive the rebuild

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest, deriveRequiredFeatures, SCHEMA_VERSION } from '@celsian/vura-contract';
import { h } from 'what-core';
import { action } from '../src/actions.js';
import { createVuraHandler, buildVuraOutput } from '../src/adapter/vura.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

const routes = [
  {
    path: '/',
    component: () => h('main', {}, 'vura'),
    mode: 'server',
    page: { mode: 'server' },
  },
];

action(async (data) => ({ echoed: data }), { id: 'vura-echo' });

function getCookie(res, name) {
  const m = (res.headers.get('set-cookie') || '').match(new RegExp(`${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// ---------------------------------------------------------------------------
// createVuraHandler
// ---------------------------------------------------------------------------

describe('createVuraHandler', () => {
  it('exposes the Function module shape: { fetch(request, env) } -> Response', async () => {
    const fn = createVuraHandler({ routes });
    assert.equal(typeof fn.fetch, 'function');
    const res = await fn.fetch(new Request('http://10.0.0.7:3001/'), Object.freeze({}));
    assert.ok(res instanceof Response);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<main>vura<\/main>/);
  });

  it('rebuilds request.url from x-forwarded-host/proto, keeping path and query', async () => {
    let seen = null;
    const fn = createVuraHandler((request) => {
      seen = request;
      return new Response('ok');
    });
    await fn.fetch(new Request('http://10.0.0.7:3001/blog/a%20b?x=1&y=2', {
      headers: { 'x-forwarded-host': 'demo.vura.app', 'x-forwarded-proto': 'https', 'x-real-ip': '203.0.113.9' },
    }), {});
    assert.equal(seen.url, 'https://demo.vura.app/blog/a%20b?x=1&y=2');
    assert.equal(seen.method, 'GET');
    assert.equal(seen.headers.get('x-real-ip'), '203.0.113.9', 'headers are preserved');
  });

  it('defaults the public protocol to https when only x-forwarded-host is present', async () => {
    let seen = null;
    const fn = createVuraHandler((request) => { seen = request; return new Response('ok'); });
    await fn.fetch(new Request('http://internal/p', { headers: { 'x-forwarded-host': 'demo.vura.app' } }), {});
    assert.equal(seen.url, 'https://demo.vura.app/p');
  });

  it('leaves the request untouched without x-forwarded-host', async () => {
    let seen = null;
    const fn = createVuraHandler((request) => { seen = request; return new Response('ok'); });
    const original = new Request('http://localhost:3001/p?q=1');
    await fn.fetch(original, {});
    assert.equal(seen.url, 'http://localhost:3001/p?q=1');
  });

  it('ignores a malformed forwarded host or protocol instead of trusting it', async () => {
    const urls = [];
    const fn = createVuraHandler((request) => { urls.push(request.url); return new Response('ok'); });
    await fn.fetch(new Request('http://internal/p', { headers: { 'x-forwarded-host': 'evil.example/@x' } }), {});
    await fn.fetch(new Request('http://internal/p', { headers: { 'x-forwarded-host': 'demo.vura.app', 'x-forwarded-proto': 'javascript' } }), {});
    assert.deepEqual(urls, ['http://internal/p', 'http://internal/p']);
  });

  it('passes a POST body through the rebuild (streamed body, duplex half)', async () => {
    let seen = null;
    const fn = createVuraHandler(async (request) => {
      seen = { url: request.url, method: request.method, type: request.headers.get('content-type'), body: await request.text() };
      return new Response('ok');
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"args":'));
        controller.enqueue(new TextEncoder().encode('[1]}'));
        controller.close();
      },
    });
    await fn.fetch(new Request('http://internal/__what_action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-host': 'demo.vura.app', 'x-forwarded-proto': 'https' },
      body: stream,
      duplex: 'half',
    }), {});
    assert.deepEqual(seen, {
      url: 'https://demo.vura.app/__what_action',
      method: 'POST',
      type: 'application/json',
      body: '{"args":[1]}',
    });
  });

  it('end to end through createRequestHandler: Secure CSRF cookie on the public origin, action round-trip', async () => {
    const fn = createVuraHandler({ routes });
    const edge = { 'x-forwarded-host': 'demo.vura.app', 'x-forwarded-proto': 'https' };
    const page = await fn.fetch(new Request('http://10.0.0.7:3001/', { headers: edge }), {});
    assert.equal(page.status, 200);
    assert.match(page.headers.get('set-cookie') || '', /what-csrf=[^;]+;.*Secure/);
    const token = getCookie(page, 'what-csrf');

    const res = await fn.fetch(new Request('http://10.0.0.7:3001/__what_action', {
      method: 'POST',
      headers: {
        ...edge,
        'content-type': 'application/json',
        'x-what-action': 'vura-echo',
        'x-csrf-token': token,
        cookie: `what-csrf=${encodeURIComponent(token)}`,
      },
      body: JSON.stringify({ args: [{ n: 1 }] }),
    }), {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { echoed: { n: 1 } });
  });

  it('exposes env to the app as request.__env (Cloudflare adapter parity)', async () => {
    let env = null;
    const fn = createVuraHandler((request) => { env = request.__env; return new Response('ok'); });
    const passed = Object.freeze({ DATABASE_URL: 'postgres://x' });
    await fn.fetch(new Request('http://internal/', { headers: { 'x-forwarded-host': 'demo.vura.app' } }), passed);
    assert.equal(env, passed);
  });
});

// ---------------------------------------------------------------------------
// buildVuraOutput
// ---------------------------------------------------------------------------

// A throwaway project outside the repo, so nothing above it has node_modules.
// esbuild is linked in, because buildVuraOutput resolves it from the project
// (the way a scaffolded app has it as a devDependency).
async function makeProject({ withEsbuild = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'what-vura-build-'));
  await mkdir(join(root, 'src', 'pages'), { recursive: true });
  await mkdir(join(root, 'public', 'img'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'fake-lib', 'src'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }));
  await writeFile(join(root, 'src', 'entry-client.js'), 'export const client = 1;\n');
  await writeFile(join(root, 'src', 'pages', 'home.js'), 'export default 1;\n');
  await writeFile(join(root, 'src', 'db.js'), 'export const secret = "server-only";\n');
  await writeFile(join(root, 'public', 'favicon.svg'), '<svg/>');
  await writeFile(join(root, 'public', 'img', 'a.png'), 'png');
  await writeFile(join(root, 'node_modules', 'fake-lib', 'src', 'index.js'), 'export const lib = 1;\n');
  await writeFile(join(root, 'node_modules', 'fake-lib', 'package.json'), '{"name":"fake-lib"}');
  // The Function entry: a relative import (must be inlined), a Node builtin
  // (must stay external) and the Function module shape.
  await writeFile(join(root, 'helper.js'), 'export const greet = (p) => `hello ${p}`;\n');
  await writeFile(join(root, 'function.js'), [
    "import { createHash } from 'node:crypto';",
    "import { greet } from './helper.js';",
    'export default {',
    '  async fetch(request, env) {',
    '    const url = new URL(request.url);',
    "    const id = createHash('sha1').update(url.pathname).digest('hex').slice(0, 8);",
    "    return new Response(`${greet(url.pathname)} ${id} ${env.GREETING || ''}`.trim());",
    '  },',
    '};',
    '',
  ].join('\n'));
  if (withEsbuild) {
    await symlink(join(repoRoot, 'node_modules', 'esbuild'), join(root, 'node_modules', 'esbuild'), 'dir');
  }
  return root;
}

const STATIC_FILES = [
  { from: 'public', to: '/' },
  'src/entry-client.js',
  'src/pages',
  'src/components', // does not exist: skipped, not an error
  'node_modules/fake-lib/src',
];

describe('buildVuraOutput', () => {
  let root;
  let summary;
  before(async () => {
    root = await makeProject();
    // Stale output from a previous build must not survive into the next one.
    await mkdir(join(root, 'dist', 'functions', 'old_route'), { recursive: true });
    await writeFile(join(root, 'dist', 'functions', 'old_route', 'index.js'), 'stale');
    summary = await buildVuraOutput({ projectRoot: root, entry: 'function.js', staticFiles: STATIC_FILES });
  });
  after(() => rm(root, { recursive: true, force: true }));

  it('writes a manifest the published @celsian/vura-contract accepts', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'dist', 'manifest.json'), 'utf8'));
    const result = validateManifest(manifest);
    assert.equal(result.success, true, JSON.stringify(result.issues, null, 2));
    assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(manifest.requiredFeatures, deriveRequiredFeatures(manifest));
    assert.deepEqual(manifest.requiredFeatures, ['api', 'function-compute']);
    assert.strictEqual(manifest.filesystemFirst, true, 'the edge must serve dist/static before the catch-all Function');
    assert.deepEqual(manifest.pages, []);
    assert.deepEqual(manifest.layouts, []);
    assert.ok(Number.isFinite(Date.parse(manifest.timestamp)));
    assert.deepEqual(summary.manifest, manifest, 'the summary returns what was written');
  });

  it('declares ONE catch-all serverless Function with all seven methods', async () => {
    const { api } = JSON.parse(await readFile(join(root, 'dist', 'manifest.json'), 'utf8'));
    assert.deepEqual(api, [{
      filePath: 'function.js',
      urlPattern: '/*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
      kind: 'serverless',
      hasWebsocket: false,
      config: { kind: 'serverless', compute: { class: 'function', memory: '1gb' } },
    }]);
  });

  it('puts the bundle where the platform derives the module path: functions/_/index.js', async () => {
    const pattern = '/*';
    const module = pattern.replace(/[/:*]/g, '_').replace(/^_/, '');
    assert.equal(module, '_');
    assert.ok(existsSync(join(root, 'dist', 'functions', module, 'index.js')));
    assert.equal(summary.functionFile, join(root, 'dist', 'functions', '_', 'index.js'));
    assert.deepEqual(JSON.parse(await readFile(join(root, 'dist', 'functions', 'package.json'), 'utf8')), { type: 'module' });
    assert.equal(existsSync(join(root, 'dist', 'functions', 'old_route')), false, 'the previous build output was cleaned');
  });

  it('bundles a self-contained ESM Function that runs with no node_modules above it', async () => {
    const isolated = await mkdtemp(join(tmpdir(), 'what-vura-run-'));
    try {
      await cp(join(root, 'dist'), join(isolated, 'dist'), { recursive: true });
      const bundle = await readFile(join(isolated, 'dist', 'functions', '_', 'index.js'), 'utf8');
      assert.doesNotMatch(bundle, /from ["']\.\/helper\.js["']/, 'relative imports are inlined');
      const mod = await import(pathToFileURL(join(isolated, 'dist', 'functions', '_', 'index.js')).href);
      const res = await mod.default.fetch(new Request('http://internal/x'), Object.freeze({ GREETING: 'from env' }));
      assert.match(await res.text(), /^hello \/x [0-9a-f]{8} from env$/);
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  });

  it('copies static files to their URL paths under dist/static, and nothing else', async () => {
    const s = join(root, 'dist', 'static');
    assert.equal(await readFile(join(s, 'favicon.svg'), 'utf8'), '<svg/>', 'public/ maps to the root');
    assert.equal(await readFile(join(s, 'img', 'a.png'), 'utf8'), 'png');
    assert.ok(existsSync(join(s, 'src', 'entry-client.js')));
    assert.ok(existsSync(join(s, 'src', 'pages', 'home.js')));
    assert.ok(existsSync(join(s, 'node_modules', 'fake-lib', 'src', 'index.js')));
    assert.equal(existsSync(join(s, 'node_modules', 'fake-lib', 'package.json')), false, 'only the listed subtree');
    assert.equal(existsSync(join(s, 'src', 'db.js')), false, 'server-only files are never copied');
    assert.equal(existsSync(join(s, 'function.js')), false);
    assert.deepEqual(summary.skipped, ['src/components']);
  });

  it('honours a different function memory size and validates it', async () => {
    const other = await makeProject();
    try {
      const out = await buildVuraOutput({ projectRoot: other, entry: 'function.js', memory: '4gb' });
      assert.equal(out.manifest.api[0].config.compute.memory, '4gb');
      assert.equal(validateManifest(out.manifest).success, true);
      await assert.rejects(
        buildVuraOutput({ projectRoot: other, entry: 'function.js', memory: '3gb' }),
        /memory must be one of 1gb, 4gb, 6gb, 8gb, 12gb/,
      );
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});

describe('buildVuraOutput refuses unsafe paths', () => {
  let root;
  before(async () => { root = await makeProject(); });
  after(() => rm(root, { recursive: true, force: true }));

  const cases = [
    ['outDir with ..', { outDir: '../escape' }, /outDir/],
    ['outDir equal to the project root', { outDir: '.' }, /outDir/],
    ['absolute outDir outside the project', { outDir: tmpdir() }, /outDir/],
    ['static source with ..', { staticFiles: ['../outside'] }, /staticFiles/],
    ['absolute static source', { staticFiles: ['/etc/hosts'] }, /staticFiles/],
    ['static target with ..', { staticFiles: [{ from: 'public', to: '/../../x' }] }, /staticFiles/],
    ['relative static target', { staticFiles: [{ from: 'public', to: 'x' }] }, /staticFiles/],
    ['entry outside the project', { entry: '../function.js' }, /entry/],
  ];
  for (const [label, opts, message] of cases) {
    it(`rejects ${label}`, async () => {
      const sentinel = join(root, 'dist', 'sentinel');
      await mkdir(join(root, 'dist'), { recursive: true });
      await writeFile(sentinel, 'keep');
      await assert.rejects(
        buildVuraOutput({ projectRoot: root, entry: 'function.js', ...opts }),
        message,
      );
      // Validation runs before anything is cleaned or written.
      assert.equal(await readFile(sentinel, 'utf8'), 'keep');
    });
  }

  it('rejects a missing entry with a clear error', async () => {
    await assert.rejects(
      buildVuraOutput({ projectRoot: root, entry: 'nope.js' }),
      /entry .*nope\.js.* does not exist/,
    );
  });

  it('never writes outside dist/static even for a crafted target', async () => {
    const outside = join(root, 'escaped.txt');
    await assert.rejects(buildVuraOutput({
      projectRoot: root,
      entry: 'function.js',
      staticFiles: [{ from: 'public/favicon.svg', to: '/%2e%2e/%2e%2e/escaped.txt' }],
    }), /staticFiles/);
    assert.equal(existsSync(outside), false);
  });
});

describe('buildVuraOutput without esbuild', () => {
  it('throws an error that names `npm i -D esbuild`', async () => {
    const root = await makeProject({ withEsbuild: false });
    try {
      await assert.rejects(
        buildVuraOutput({ projectRoot: root, entry: 'function.js' }),
        (err) => {
          assert.match(err.message, /esbuild/);
          assert.match(err.message, /npm i -D esbuild/);
          return true;
        },
      );
      assert.equal((await stat(join(root, 'function.js'))).isFile(), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
