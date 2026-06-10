// Deploy-readiness verification (D7, sprint/v0.11-quality).
//
// One suite per deploy adapter, each proving the adapter's OUTPUT actually
// serves the way the deploy docs (packages/server/README.md "Deploying") say:
//
//   node       — boot a real http.Server, fetch over TCP: HTML, CSRF cookie
//                provisioning, action POST round-trip, 404, graceful close.
//   static     — exportStatic to a dir, serve that dir with a dumb file
//                server (what any static host does), assert pages + data.json.
//   vercel     — buildVercelOutput produces a Build Output API v3 layout:
//                config.json (version 3, filesystem-first routes) +
//                functions/<name>.func/.vc-config.json + handler entry.
//   cloudflare — module-worker shape (`export default { fetch }`), request
//                handling, env/ctx passthrough. workerd/miniflare are not repo
//                deps, so real-runtime execution is a documented manual step
//                (`wrangler dev`); everything testable without them is here.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, rm, mkdtemp, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { h } from 'what-core';
import { action } from '../src/actions.js';
import { createServer } from '../src/adapter/node.js';
import { exportStatic } from '../src/adapter/static.js';
import { createVercelHandler, buildVercelOutput } from '../src/adapter/vercel.js';
import { createCloudflareHandler } from '../src/adapter/cloudflare.js';

const routes = [
  {
    path: '/',
    component: ({ loaderData }) => h('main', {}, `hello ${loaderData.name}`),
    loader: () => ({ name: 'deploy' }),
    mode: 'server', page: { mode: 'server' },
  },
];

action(async (data) => ({ echoed: data }), { id: 'deploy-echo' });

function getCookie(res, name) {
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(new RegExp(`${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// =========================================================================
// Node adapter — the canonical self-hosted deploy (node server.js)
// =========================================================================

describe('deploy-readiness: node adapter', () => {
  let server, base;
  before(async () => {
    server = createServer({ routes });
    await new Promise((res) => server.listen(0, res));
    base = `http://localhost:${server.address().port}`;
  });
  after(() => server.close());

  it('serves HTML over real TCP with the CSRF cookie auto-provisioned', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const token = getCookie(res, 'what-csrf');
    assert.ok(token, 'first response must Set-Cookie the what-csrf token');
    const html = await res.text();
    assert.match(html, /hello deploy/);
    // server-mode render is uncached → token also embedded for forms/fetch
    assert.ok(html.includes('what-csrf-token'), 'uncached HTML embeds the CSRF meta tag');
  });

  it('completes a full action round-trip exactly like a deployed client', async () => {
    // 1. land on a page (get the cookie) — what a browser does
    const page = await fetch(`${base}/`);
    const token = getCookie(page, 'what-csrf');
    // 2. POST the action with cookie + echoed header — what the action() client does
    const res = await fetch(`${base}/__what_action`, {
      method: 'POST',
      headers: {
        'x-what-action': 'deploy-echo',
        'content-type': 'application/json',
        'x-csrf-token': token,
        cookie: `what-csrf=${encodeURIComponent(token)}`,
      },
      body: JSON.stringify({ args: [{ n: 1 }] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { echoed: { n: 1 } });
  });

  it('rejects a forged cross-site action POST (no cookie/token) with 403', async () => {
    const res = await fetch(`${base}/__what_action`, {
      method: 'POST',
      headers: { 'x-what-action': 'deploy-echo', 'content-type': 'application/json' },
      body: JSON.stringify({ args: [{}] }),
    });
    assert.equal(res.status, 403);
  });

  it('404s unknown paths (load balancer health semantics)', async () => {
    const res = await fetch(`${base}/definitely-not-a-route`);
    assert.equal(res.status, 404);
  });
});

// =========================================================================
// Static adapter — exportStatic output must serve from ANY static host
// =========================================================================

function serveDir(dir) {
  // Deliberately dumb: this mirrors nginx/CDN behavior (path -> file), so the
  // test proves the export layout works on a host with zero special config.
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let filePath = normalize(join(dir, urlPath));
    if (!filePath.startsWith(dir)) { res.writeHead(403); return res.end(); }
    stat(filePath).then((s) => {
      if (s.isDirectory()) filePath = join(filePath, 'index.html');
      const stream = createReadStream(filePath);
      stream.on('error', () => { res.writeHead(404); res.end(); });
      stream.on('open', () => {
        res.writeHead(200, { 'content-type': filePath.endsWith('.json') ? 'application/json' : 'text/html' });
        stream.pipe(res);
      });
    }).catch(() => { res.writeHead(404); res.end(); });
  });
}

describe('deploy-readiness: static adapter', () => {
  let outDir, server, base;
  before(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'what-deploy-static-'));
    const staticRoutes = [
      { path: '/', component: () => h('main', {}, 'static home'), page: { mode: 'static' } },
      {
        path: '/posts/:slug',
        component: ({ loaderData }) => h('article', {}, loaderData.title),
        loader: ({ params }) => ({ title: `post:${params.slug}` }),
        getStaticPaths: async () => ({ paths: [{ params: { slug: 'one' } }] }),
        page: { mode: 'static' },
      },
    ];
    const { pages } = await exportStatic({ routes: staticRoutes, outDir });
    assert.deepEqual(pages.sort(), ['/', '/posts/one']);
    server = serveDir(outDir);
    await new Promise((res) => server.listen(0, res));
    base = `http://localhost:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await rm(outDir, { recursive: true, force: true });
  });

  it('generated site serves from a plain file server (CDN-equivalent)', async () => {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /static home/);

    const post = await fetch(`${base}/posts/one/`);
    assert.equal(post.status, 200);
    assert.match(await post.text(), /post:one/);
  });

  it('serves __what_data.json for client-side navigation', async () => {
    const res = await fetch(`${base}/posts/one/__what_data.json`);
    assert.equal(res.status, 200);
    const data = JSON.parse(await res.text());
    assert.deepEqual(data.loaderData, { title: 'post:one' });
  });
});

// =========================================================================
// Vercel adapter — Build Output API v3 structure (validated statically)
// =========================================================================

describe('deploy-readiness: vercel adapter (Build Output API v3)', () => {
  it('emits a complete v3 layout: config + functions/<name>.func + handler', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'what-deploy-vercel-'));
    try {
      const { config, functionDir } = await buildVercelOutput({
        outDir: dir,
        files: { 'index.mjs': 'export default (req) => new Response("ok");\n' },
      });

      // config.json — version 3, filesystem-first, catch-all to the function
      const cfg = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
      assert.equal(cfg.version, 3);
      assert.deepEqual(cfg, config);
      assert.ok(cfg.routes.some((r) => r.handle === 'filesystem'), 'static assets must win before the function');
      assert.ok(cfg.routes.some((r) => r.dest === '/render'), 'catch-all must route to the render function');

      // functions/render.func/.vc-config.json — required keys per Build Output API v3
      assert.equal(functionDir, join(dir, 'functions', 'render.func'));
      const vc = JSON.parse(await readFile(join(functionDir, '.vc-config.json'), 'utf8'));
      assert.match(vc.runtime, /^nodejs\d+\.x$/, 'runtime must be a Vercel Node runtime id');
      assert.equal(vc.handler, 'index.mjs');
      assert.equal(vc.launcherType, 'Nodejs');

      // the handler entry referenced by .vc-config.json must exist
      assert.ok(existsSync(join(functionDir, vc.handler)), 'handler entry must exist inside the .func dir');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('stays backward compatible: no files -> config.json only (build step owns functions/)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'what-deploy-vercel-legacy-'));
    try {
      const { functionDir } = await buildVercelOutput({ outDir: dir });
      assert.equal(functionDir, null);
      assert.ok(existsSync(join(dir, 'config.json')));
      assert.ok(!existsSync(join(dir, 'functions')), 'must not emit an empty functions dir');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('the runtime handler is a plain Web-Fetch function (what Vercel invokes)', async () => {
    const handler = createVercelHandler({ routes });
    assert.equal(typeof handler, 'function');
    const res = await handler(new Request('http://x/'));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /hello deploy/);
  });
});

// =========================================================================
// Cloudflare adapter — ES-module worker shape
// =========================================================================

describe('deploy-readiness: cloudflare adapter (module worker shape)', () => {
  it('returns a wrangler-compatible module worker: object with async fetch()', async () => {
    const worker = createCloudflareHandler({ routes });
    // `export default worker` must satisfy the ES module worker contract:
    // a plain object whose `fetch` is callable with (request, env, ctx).
    assert.equal(typeof worker, 'object');
    assert.equal(typeof worker.fetch, 'function');
    assert.equal(worker.fetch.length, 3, 'fetch must accept (request, env, ctx)');

    const res = await worker.fetch(new Request('http://x/'), {}, { waitUntil() {} });
    assert.ok(res instanceof Response);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /hello deploy/);
  });

  it('passes env/ctx through to the request for bindings (KV, D1, waitUntil)', async () => {
    let seen;
    const worker = createCloudflareHandler({
      routes: [{
        path: '/',
        component: () => h('main', {}, 'cf'),
        loader: ({ request }) => { seen = { env: request.__env, ctx: request.__ctx }; return {}; },
        mode: 'server', page: { mode: 'server' },
      }],
    });
    const env = { MY_KV: 'binding' };
    const ctx = { waitUntil() {} };
    await worker.fetch(new Request('http://x/'), env, ctx);
    assert.equal(seen.env, env);
    assert.equal(seen.ctx, ctx);
  });

  it('handles action POSTs through the worker fetch path (CSRF enforced)', async () => {
    const worker = createCloudflareHandler({ routes });
    const token = 'cf-token-123';
    const ok = await worker.fetch(new Request('http://x/__what_action', {
      method: 'POST',
      headers: {
        'x-what-action': 'deploy-echo',
        'content-type': 'application/json',
        'x-csrf-token': token,
        cookie: `what-csrf=${token}`,
      },
      body: JSON.stringify({ args: [{ cf: true }] }),
    }), {}, { waitUntil() {} });
    assert.equal(ok.status, 200);

    const forged = await worker.fetch(new Request('http://x/__what_action', {
      method: 'POST',
      headers: { 'x-what-action': 'deploy-echo', 'content-type': 'application/json' },
      body: JSON.stringify({ args: [{}] }),
    }), {}, { waitUntil() {} });
    assert.equal(forged.status, 403);
  });

  // workerd/miniflare are not repo dependencies. Real-runtime verification is
  // a manual step, documented in packages/server/README.md "Deploying":
  //   wrangler dev worker.js   (worker.js: export default createCloudflareHandler({ routes }))
});
