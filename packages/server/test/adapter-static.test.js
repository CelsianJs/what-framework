// Static export adapter (Phase 7).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { h } from 'what-core';
import { exportStatic } from '../src/adapter/static.js';
import { renderDocument } from '../src/index.js';

let outDir;
before(async () => { outDir = await mkdtemp(join(tmpdir(), 'whatexport-')); });
after(async () => { await rm(outDir, { recursive: true, force: true }); });

describe('exportStatic', () => {
  for (const mode of ['static', 'hybrid']) {
    it(`shares one loader snapshot between ${mode} HTML and navigation data`, async () => {
      let calls = 0;
      const path = `/snapshot-${mode}`;
      await exportStatic({ outDir, routes: [{
        path, page: { mode },
        component: ({ loaderData }) => h('main', {}, `revision:${loaderData.revision}`),
        loader: async () => ({ revision: ++calls }),
      }] });
      const html = await readFile(join(outDir, path, 'index.html'), 'utf8');
      const inline = JSON.parse(html.match(/<script id="__what_data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
      const data = JSON.parse(await readFile(join(outDir, path, '__what_data.json'), 'utf8'));
      assert.equal(calls, 1);
      assert.match(html, /<main>revision:1<\/main>/);
      assert.deepEqual(data.loaderData, inline.loaderData);
    });
  }

  it('isolates snapshots across concrete paths and repeated exports', async () => {
    let calls = 0;
    const route = {
      path: '/snapshots/:slug', page: { mode: 'static' },
      getStaticPaths: async () => ({ paths: [{ params: { slug: 'a' } }, { params: { slug: 'b' } }] }),
      loader: async ({ params }) => ({ slug: params.slug, revision: ++calls }),
      component: ({ loaderData }) => h('main', {}, `${loaderData.slug}:${loaderData.revision}`),
    };
    const originalLoader = route.loader;
    for (const round of [0, 1]) {
      await exportStatic({ outDir, routes: [route] });
      for (const [index, slug] of ['a', 'b'].entries()) {
        const data = JSON.parse(await readFile(join(outDir, `snapshots/${slug}/__what_data.json`), 'utf8'));
        assert.deepEqual(data.loaderData, { slug, revision: round * 2 + index + 1 });
      }
    }
    assert.equal(calls, 4);
    assert.equal(route.loader, originalLoader, 'do not replace the caller-owned loader');
  });

  it('shares the snapshot with a custom renderer even if it reads the loader repeatedly', async () => {
    let calls = 0;
    const render = async (page, ctx) => {
      const first = await page.loader(ctx);
      const second = await page.loader(ctx);
      assert.equal(first, second);
      return renderDocument(page, ctx);
    };
    await exportStatic({ outDir, render, routes: [{
      path: '/custom-snapshot', page: { mode: 'static' },
      loader: async () => ({ revision: ++calls }),
      component: ({ loaderData }) => h('main', {}, loaderData.revision),
    }] });
    assert.equal(calls, 1);
    const data = JSON.parse(await readFile(join(outDir, 'custom-snapshot/__what_data.json'), 'utf8'));
    assert.deepEqual(data.loaderData, { revision: 1 });
  });

  it('does not write an HTML artifact when its loader rejects', async () => {
    const error = new Error('snapshot unavailable');
    await assert.rejects(exportStatic({ outDir, routes: [{
      path: '/rejected-snapshot', page: { mode: 'static' },
      loader: async () => { throw error; },
      component: () => h('main', {}, 'unreachable'),
    }] }), error);
    await assert.rejects(readFile(join(outDir, 'rejected-snapshot/index.html')), { code: 'ENOENT' });
  });

  it('lets custom renderers prepare loader context before the first read', async () => {
    let calls = 0;
    await exportStatic({ outDir, routes: [{
      path: '/prepared-context', page: { mode: 'static' },
      loader: ({ query }) => {
        calls++;
        assert.equal(query.preview, true);
        return { preview: query.preview };
      },
      component: ({ loaderData }) => h('main', {}, String(loaderData.preview)),
    }], render: async (page, ctx) => {
      assert.equal(calls, 0, 'the renderer decides when to read its snapshot');
      ctx.query.preview = true;
      return renderDocument(page, ctx);
    } });
    const data = JSON.parse(await readFile(join(outDir, 'prepared-context/__what_data.json'), 'utf8'));
    assert.equal(calls, 1);
    assert.deepEqual(data.loaderData, { preview: true });
  });

  it('loads navigation data once even when a custom renderer does not read it', async () => {
    let calls = 0;
    await exportStatic({ outDir, render: () => '<main>custom</main>', routes: [{
      path: '/custom-no-read', page: { mode: 'static' },
      loader: () => { calls++; return undefined; },
    }] });
    assert.equal(calls, 1);
    const data = JSON.parse(await readFile(join(outDir, 'custom-no-read/__what_data.json'), 'utf8'));
    assert.deepEqual(data, {});
  });

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

  it('refuses a getStaticPaths param that escapes outDir', async () => {
    const escaped = join(outDir, '..', 'whatexport-escaped');
    const routes = [{
      path: '/blog/:slug',
      component: () => h('article', {}, 'x'),
      getStaticPaths: async () => ({ paths: [{ params: { slug: '../../whatexport-escaped' } }] }),
      page: { mode: 'static' },
    }];
    await assert.rejects(() => exportStatic({ routes, outDir }), /outside outDir/);
    await assert.rejects(() => readFile(join(escaped, 'index.html'), 'utf8'), { code: 'ENOENT' });
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
