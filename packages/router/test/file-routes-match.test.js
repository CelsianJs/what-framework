// The routes the compiler's file router writes match the URLs of their pages,
// on <FileRouter> and on a server's matchRoute: a page file's path is its
// URL, [id] is a param and [...slug] a catch-all, which the compiler writes
// as '/docs/*slug'. Before, the router read '*slug' as a static segment, so
// every catch-all page file 404ed.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scanPages } from '../../compiler/src/file-router.js';
import { matchRoute } from '../src/match.js';

const PAGES = mkdtempSync(join(tmpdir(), 'what-file-routes-'));
after(() => rmSync(PAGES, { recursive: true, force: true }));

for (const file of ['index.jsx', 'about.jsx', 'users/[id].jsx', 'docs/index.jsx', 'docs/[...slug].jsx', 'files/[...path].jsx']) {
  mkdirSync(dirname(join(PAGES, file)), { recursive: true });
  writeFileSync(join(PAGES, file), 'export default function Page() {}\n');
}
const routes = scanPages(PAGES).pages.map((page) => ({ path: page.routePath }));

describe('the file router\'s routes', () => {
  it('match the URLs of their pages, a catch-all included', () => {
    for (const [url, path, params] of [
      ['/', '/', {}],
      ['/about', '/about', {}],
      ['/users/7', '/users/:id', { id: '7' }],
      ['/docs', '/docs', {}],
      ['/docs/guide/install', '/docs/*slug', { slug: 'guide/install' }],
      ['/files/a%20b/c.txt', '/files/*path', { path: 'a b/c.txt' }],
    ]) {
      const m = matchRoute(url, routes);
      assert.equal(m && m.route.path, path, url);
      assert.deepEqual(m.params, params, url);
    }
  });
});
