// Edge adapters (Phase 7): Cloudflare worker + Vercel function are thin Web-Fetch
// handlers over the same core.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { createCloudflareHandler } from '../src/adapter/cloudflare.js';
import { createVercelHandler, buildVercelOutput } from '../src/adapter/vercel.js';

const routes = [{ path: '/', component: () => h('main', {}, 'edge'), mode: 'server', page: { mode: 'server' } }];

describe('Cloudflare adapter', () => {
  it('exposes a fetch(request, env, ctx) that renders', async () => {
    const worker = createCloudflareHandler({ routes });
    const res = await worker.fetch(new Request('http://x/'), {}, { waitUntil() {} });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<main>edge<\/main>/);
  });
});

describe('Vercel adapter', () => {
  it('createVercelHandler renders as a Web-Fetch function', async () => {
    const handler = createVercelHandler({ routes });
    const res = await handler(new Request('http://x/'));
    assert.match(await res.text(), /edge/);
  });

  it('buildVercelOutput emits a v3 config routing to the function', async () => {
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'whatvercel-'));
    await buildVercelOutput({ outDir: dir });
    const cfg = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    assert.equal(cfg.version, 3);
    assert.ok(cfg.routes.some((r) => r.dest === '/render'));
    await rm(dir, { recursive: true, force: true });
  });
});
