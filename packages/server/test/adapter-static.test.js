// Static export adapter (Phase 7).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { h } from 'what-core';
import { exportStatic } from '../src/adapter/static.js';

let outDir;
before(async () => { outDir = await mkdtemp(join(tmpdir(), 'whatexport-')); });
after(async () => { await rm(outDir, { recursive: true, force: true }); });

describe('exportStatic', () => {
  it('renders a static route to index.html', async () => {
    const routes = [{ path: '/', component: () => h('main', {}, 'home'), page: { mode: 'static' } }];
    const { pages } = await exportStatic({ routes, outDir });
    assert.deepEqual(pages, ['/']);
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    assert.match(html, /<main>home<\/main>/);
    assert.match(html, /<!DOCTYPE html>/i);
  });

  it('expands a dynamic route via getStaticPaths', async () => {
    const routes = [{
      path: '/blog/:slug',
      component: ({ loaderData }) => h('article', {}, loaderData.title),
      loader: ({ params }) => ({ title: `Post ${params.slug}` }),
      getStaticPaths: async () => ({ paths: [{ params: { slug: 'a' } }, { params: { slug: 'b' } }], fallback: false }),
      page: { mode: 'static', revalidate: 60 },
    }];
    const { pages } = await exportStatic({ routes, outDir });
    assert.deepEqual(pages.sort(), ['/blog/a', '/blog/b']);
    const html = await readFile(join(outDir, 'blog/a/index.html'), 'utf8');
    assert.match(html, /Post a/);
    const data = JSON.parse(await readFile(join(outDir, 'blog/a/__what_data.json'), 'utf8'));
    assert.deepEqual(data.loaderData, { title: 'Post a' });
  });

  it('skips server-mode and dynamic-without-getStaticPaths routes', async () => {
    const routes = [
      { path: '/srv', component: () => h('main', {}, 'x'), page: { mode: 'server' } },
      { path: '/d/:id', component: () => h('main', {}, 'x'), page: { mode: 'static' } },
    ];
    const { pages } = await exportStatic({ routes, outDir });
    assert.deepEqual(pages, []);
  });
});
