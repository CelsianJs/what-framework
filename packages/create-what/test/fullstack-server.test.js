// Boots the --fullstack scaffold's server.js (with node_modules symlinked at
// the workspace packages — no npm install, no network) and asserts the audit
// fixes over real HTTP:
//   - static serving is deny-by-default: server-only modules (src/db.js,
//     src/actions/**, src/routes.js) are 404 while the client allowlist
//     (entry-client, styles, pages, framework modules) is 200
//   - /new SSRs the no-JS progressive-enhancement fields (_action,
//     what-csrf-token, _redirect) and a plain form-encoded POST creates a post
//   - unknown routes return a real 404 status and are never ISR-cached
//   - the ISR cache still works for legit routes (second hit is a HIT)

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const createWhat = resolve(repoRoot, 'packages/create-what/index.js');

// Workspace dir -> package name, for everything server.js (or the import map)
// resolves at runtime. Symlinks instead of npm install keep the test hermetic;
// transitive deps (what-router, what-server, ...) resolve through the repo
// root's workspace links because Node resolves from the symlink target's
// real path.
const LINKS = {
  'packages/what': 'what-framework',
  'packages/core': 'what-core',
  'packages/cache': 'what-isr',
};

const PORT = 4650 + (process.pid % 40); // 4650-4689, collision-resistant
const BASE = `http://localhost:${PORT}`;

async function scaffoldAndBoot(workDir) {
  const out = spawnSync(process.execPath, [createWhat, 'fs-app', '--fullstack', '--yes'], {
    cwd: workDir, encoding: 'utf8',
  });
  assert.equal(out.status, 0, out.stderr);
  const appDir = join(workDir, 'fs-app');

  await mkdir(join(appDir, 'node_modules'), { recursive: true });
  for (const [dir, name] of Object.entries(LINKS)) {
    await symlink(resolve(repoRoot, dir), join(appDir, 'node_modules', name), 'dir');
  }

  const child = spawn(process.execPath, ['server.js'], {
    cwd: appDir,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.logs = '';
  child.stdout.on('data', (d) => { child.logs += d; });
  child.stderr.on('data', (d) => { child.logs += d; });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      assert.fail(`server.js exited (${child.exitCode}) before listening:\n${child.logs}`);
    }
    try {
      const res = await fetch(BASE + '/');
      if (res.ok) return { appDir, child };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.fail(`server.js did not answer on :${PORT} within 15s:\n${child.logs}`);
}

function readCsrfCookie(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/what-csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

test('fullstack scaffold server: /src/ allowlist, no-JS form, real 404s, ISR', async (t) => {
  const workDir = await mkdtemp(join(tmpdir(), 'create-what-boot-'));
  const { child } = await scaffoldAndBoot(workDir);

  try {
    await t.test('SSR document renders with hydration payload + import map', async () => {
      const res = await fetch(BASE + '/');
      const html = await res.text();
      assert.equal(res.status, 200);
      assert.match(html, /id="__what_data"/, 'embeds the hydration payload');
      assert.match(html, /src="\/src\/entry-client\.js"/, 'references the client entry');
      assert.match(html, /type="importmap"/, 'injects the import map');
    });

    await t.test('server-only modules are NOT served over HTTP', async () => {
      for (const path of ['/src/db.js', '/src/actions/posts.js', '/src/routes.js']) {
        const res = await fetch(BASE + path);
        assert.equal(res.status, 404, `${path} must be blocked (got ${res.status})`);
      }
      // Unlisted src files are blocked too (deny-by-default, not a blocklist).
      assert.equal((await fetch(BASE + '/src/secrets.js')).status, 404);
    });

    await t.test('allowlisted client files ARE served', async () => {
      for (const path of [
        '/src/entry-client.js',
        '/src/styles.css',
        '/src/pages/home.js',
        '/src/pages/post.js',
        '/src/pages/new.js',
        '/node_modules/what-framework/src/index.js',
        '/node_modules/what-core/src/index.js',
      ]) {
        const res = await fetch(BASE + path);
        assert.equal(res.status, 200, `${path} must be served (got ${res.status})`);
      }
      // The client never imports server-only modules: entry-client + pages
      // must not statically import ./routes.js or ../db.js.
      const entry = await (await fetch(BASE + '/src/entry-client.js')).text();
      assert.doesNotMatch(entry, /^import .*routes\.js/m);
      for (const page of ['home', 'post', 'new']) {
        const src = await (await fetch(BASE + `/src/pages/${page}.js`)).text();
        assert.doesNotMatch(src, /^import .*db\.js/m, `pages/${page}.js must not statically import db.js`);
      }
    });

    await t.test('/new SSRs the no-JS progressive-enhancement fields', async () => {
      const res = await fetch(BASE + '/new');
      const html = await res.text();
      assert.equal(res.status, 200);
      assert.match(html, /<input type="hidden" name="_action" value="createPost"/);
      assert.match(html, /<input type="hidden" name="what-csrf-token" value="[^"]+"/, 'CSRF token field is non-empty');
      assert.match(html, /<input type="hidden" name="_redirect" value="\/"/);
      // Double-submit contract: the SSR'd token matches the cookie token.
      const cookieToken = readCsrfCookie(res);
      const fieldToken = html.match(/name="what-csrf-token" value="([^"]+)"/)[1];
      assert.ok(cookieToken, 'response sets the what-csrf cookie');
      assert.equal(fieldToken, cookieToken, 'form token matches the cookie (double-submit)');
    });

    await t.test('a plain form-encoded POST (no JS) creates a post end-to-end', async () => {
      const formRes = await fetch(BASE + '/new');
      const token = readCsrfCookie(formRes);
      const body = new URLSearchParams({
        _action: 'createPost',
        'what-csrf-token': token,
        _redirect: '/',
        title: 'No JS Boot Post',
        body: 'Created by a form-encoded POST in fullstack-server.test.js.',
      });
      const post = await fetch(BASE + '/__what_action', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: `what-csrf=${encodeURIComponent(token)}`,
        },
        body: body.toString(),
      });
      assert.equal(post.status, 303, `expected 303 redirect, got ${post.status}: ${await post.text()}`);
      assert.equal(post.headers.get('location'), '/');

      const page = await fetch(BASE + '/blog/no-js-boot-post');
      assert.equal(page.status, 200, 'created post is served');
      assert.match(await page.text(), /No JS Boot Post/);

      const home = await (await fetch(BASE + '/')).text();
      assert.match(home, /No JS Boot Post/, 'action revalidated the cached home listing');
    });

    await t.test('unknown routes return 404 and are never ISR-cached', async () => {
      const first = await fetch(BASE + '/blog/definitely-not-a-post');
      assert.equal(first.status, 404);
      const second = await fetch(BASE + '/blog/definitely-not-a-post');
      assert.equal(second.status, 404, 'still 404 on the second request');
      assert.notEqual(second.headers.get('x-what-cache'), 'HIT', '404s must not be served from the ISR cache');
      assert.equal((await fetch(BASE + '/no-such-route')).status, 404, 'unmatched paths are 404 too');
    });

    await t.test('ISR still caches legit routes (second request is a HIT)', async () => {
      await fetch(BASE + '/blog/hello-world');
      const second = await fetch(BASE + '/blog/hello-world');
      assert.equal(second.status, 200);
      assert.equal(second.headers.get('x-what-cache'), 'HIT');
    });
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => { child.on('exit', r); setTimeout(r, 2000); });
    await rm(workDir, { recursive: true, force: true });
  }
});
