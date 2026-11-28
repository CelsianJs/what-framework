// The --fullstack scaffold answers a page with the status, headers and
// redirect its render set: server.js renders with what-server's own route
// renderer (createRouteRenderer) instead of a copy of it, which dropped the
// `response` a loader and a <Router> middleware redirect through (round 5,
// agent session F1). A missing post still answers 404 and is never cached.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../../..');
const createWhat = resolve(repoRoot, 'packages/create-what/index.js');
const LINKS = {
  'packages/what': 'what-framework',
  'packages/core': 'what-core',
  'packages/router': 'what-router',
  'packages/server': 'what-server',
  'packages/compiler': 'what-compiler',
  'packages/cache': 'what-isr',
};

const GATE = `import { h } from 'what-framework';
export const page = { mode: 'server' };
export const loader = ({ response }) => { response.redirect('/'); return {}; };
export default function Gate() { return h('main', {}, 'secret'); }
`;

const LAB = `import { h } from 'what-framework';
import { Router } from 'what-framework/router';
export const page = { mode: 'server' };
export const loader = () => ({});
const routes = [
  { path: '/lab/login', component: () => h('h2', {}, 'Log in') },
  { path: '/lab/dashboard', component: () => h('h2', {}, 'Dashboard'), middleware: [() => '/lab/login'] },
];
export default function Lab() { return h('main', {}, h(Router, { routes })); }
`;

test('the full-stack scaffold answers loader and router redirects, and a missing post with 404', async (t) => {
  const workDir = await mkdtemp(join(tmpdir(), 'what-fs-redirects-'));
  t.after(() => rm(workDir, { recursive: true, force: true }));
  const out = spawnSync(process.execPath, [createWhat, 'redir-app', '--fullstack', '--yes'], { cwd: workDir, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const appDir = join(workDir, 'redir-app');
  await mkdir(join(appDir, 'node_modules'), { recursive: true });
  for (const [dir, name] of Object.entries(LINKS)) await symlink(resolve(repoRoot, dir), join(appDir, 'node_modules', name), 'dir');

  await writeFile(join(appDir, 'src/pages/gate.js'), GATE);
  await writeFile(join(appDir, 'src/pages/lab.js'), LAB);
  const routesFile = join(appDir, 'src/routes.js');
  const routes = await readFile(routesFile, 'utf8');
  await writeFile(routesFile, routes
    .replace("import './actions/posts.js';", "import './actions/posts.js';\nimport Gate, { loader as gateLoader, page as gatePage } from './pages/gate.js';\nimport Lab, { loader as labLoader, page as labPage } from './pages/lab.js';")
    .replace('export const routes = [', "export const routes = [\n  { path: '/gate', component: Gate, loader: gateLoader, page: gatePage, mode: gatePage.mode },\n  { path: '/lab/:sub', component: Lab, loader: labLoader, page: labPage, mode: labPage.mode },"));

  const { createHandler } = await import(pathToFileURL(join(appDir, 'server.js')).href);
  const handler = createHandler();
  const answer = async (path) => {
    const res = await handler(new Request(`http://localhost${path}`));
    await res.text();
    return [res.status, res.headers.get('location')];
  };
  assert.deepEqual(await answer('/gate'), [302, '/']);
  const [status, location] = await answer('/lab/dashboard');
  assert.ok(status >= 300 && status < 400, `a <Router> middleware redirect answers a redirect (got ${status})`);
  assert.equal(location, '/lab/login');
  assert.deepEqual(await answer('/blog/no-such-post'), [404, null]);
  const again = await handler(new Request('http://localhost/blog/no-such-post'));
  assert.equal(again.status, 404);
  assert.notEqual(again.headers.get('x-what-cache'), 'HIT', 'a 404 is never served from the cache');
});
