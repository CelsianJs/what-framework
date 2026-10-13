// `npm run build` in the --fullstack scaffold writes Vura output: static files
// plus ONE scale-to-zero Function. This scaffolds the app (node_modules
// symlinked at the workspace packages, no npm install, no network), runs the
// build script, then runs the produced Function from a copy of dist/ with no
// node_modules anywhere above it, which is how the Vura runtime runs it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { validateManifest } from '@celsian/vura-contract';

const repoRoot = resolve(import.meta.dirname, '../../..');
const createWhat = resolve(repoRoot, 'packages/create-what/index.js');

const LINKS = {
  'packages/what': 'what-framework',
  'packages/core': 'what-core',
  'packages/router': 'what-router',
  'packages/server': 'what-server',
  'packages/compiler': 'what-compiler',
  'packages/cache': 'what-isr',
  'packages/devtools': 'what-devtools',
  'packages/devtools-mcp': 'what-devtools-mcp',
  'node_modules/esbuild': 'esbuild',
};

async function scaffold(workDir, name = 'vura-app') {
  const out = spawnSync(process.execPath, [createWhat, name, '--fullstack', '--yes'], { cwd: workDir, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const appDir = join(workDir, name);
  await mkdir(join(appDir, 'node_modules'), { recursive: true });
  for (const [dir, pkg] of Object.entries(LINKS)) {
    await symlink(resolve(repoRoot, dir), join(appDir, 'node_modules', pkg), 'dir');
  }
  return appDir;
}

test('fullstack scaffold declares the Vura build', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'create-what-vura-files-'));
  try {
    const out = spawnSync(process.execPath, [createWhat, 'files-app', '--fullstack', '--yes'], { cwd: workDir, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const appDir = join(workDir, 'files-app');
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.build, 'node build.js');
    assert.equal(pkg.scripts.dev, 'node --watch server.js', 'dev is unchanged');
    assert.equal(pkg.scripts.start, 'node server.js', 'start is unchanged');
    assert.match(pkg.devDependencies.esbuild || '', /^\^0\.\d+\.\d+$/, 'esbuild is a devDependency');
    assert.equal(pkg.dependencies.esbuild, undefined, 'and never a runtime dependency');

    const read = (f) => readFile(join(appDir, f), 'utf8');
    const [server, build, fn, clientFiles, config, readme, claude] = await Promise.all(
      ['server.js', 'build.js', 'function.js', 'client-files.js', 'what.config.js', 'README.md', 'CLAUDE.md'].map(read),
    );

    // One allowlist: server.js serves it, build.js publishes it.
    assert.match(clientFiles, /export const CLIENT_FILES/);
    assert.match(server, /from '\.\/client-files\.js'/);
    assert.match(build, /from '\.\/client-files\.js'/);
    assert.doesNotMatch(server, /new Set\(\['\/src\/entry-client\.js'/, 'server.js no longer hard-codes its own list');

    // The Function reuses server.js's handler instead of re-wiring SSR + ISR.
    assert.match(fn, /import \{ createHandler \} from '\.\/server\.js'/);
    assert.match(fn, /createVuraHandler\(createHandler\(\)\)/);
    assert.match(build, /buildVuraOutput/);

    assert.doesNotMatch(config, /`what build` \/ `what start` read this to pick a\s+\/\/ deploy adapter/, 'the false claim is gone');
    assert.match(config, /npm run build/);
    assert.match(readme, /npm run build/);
    assert.match(readme, /Vura/);
    assert.match(claude, /client-files\.js/, 'agents are told where the client allowlist lives');

    const eslint = await read('eslint.config.js');
    assert.match(eslint, /ignores: \[[^\]]*'dist'/, 'lint ignores the build output');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test('fullstack scaffold `npm run build` writes Vura output that runs with no node_modules', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'create-what-vura-build-'));
  try {
    const appDir = await scaffold(workDir);
    const build = spawnSync(process.execPath, ['build.js'], { cwd: appDir, encoding: 'utf8' });
    assert.equal(build.status, 0, `build failed:\n${build.stdout}\n${build.stderr}`);
    assert.doesNotMatch(build.stdout + build.stderr, /WHAT_REVALIDATE_SECRET/, 'building does not boot the server');

    // Manifest: valid against the published contract, free tier only.
    const manifest = JSON.parse(await readFile(join(appDir, 'dist', 'manifest.json'), 'utf8'));
    const result = validateManifest(manifest);
    assert.equal(result.success, true, JSON.stringify(result.issues, null, 2));
    assert.deepEqual(manifest.requiredFeatures, ['api', 'function-compute']);
    assert.equal(manifest.api.length, 1);
    assert.equal(manifest.api[0].urlPattern, '/*');
    assert.equal(manifest.api[0].filePath, 'function.js');
    assert.ok(existsSync(join(appDir, 'dist', 'functions', '_', 'index.js')));

    // Static: exactly the client allowlist plus public/, never server code.
    const s = join(appDir, 'dist', 'static');
    for (const f of [
      'favicon.svg',
      'src/entry-client.js',
      'src/styles.css',
      'src/pages/home.js',
      'src/pages/post.js',
      'src/pages/new.js',
      'node_modules/what-framework/src/index.js',
      'node_modules/what-core/src/index.js',
    ]) {
      assert.ok(existsSync(join(s, f)), `dist/static/${f} is published`);
    }
    for (const f of ['src/db.js', 'src/routes.js', 'src/actions', 'server.js', 'function.js', 'node_modules/what-devtools', 'node_modules/what-devtools-mcp', 'node_modules/what-server']) {
      assert.equal(existsSync(join(s, f)), false, `dist/static/${f} must not be published`);
    }

    // Run the Function the way the platform does: dist/ alone, NODE_ENV=production,
    // no WHAT_REVALIDATE_SECRET, behind the edge's forwarded headers.
    const isolated = await mkdtemp(join(tmpdir(), 'create-what-vura-run-'));
    try {
      await cp(join(appDir, 'dist'), join(isolated, 'dist'), { recursive: true });
      assert.deepEqual(readdirSync(isolated), ['dist']);
      const probe = join(isolated, 'probe.mjs');
      await writeFile(probe, `
        const { default: fn } = await import('./dist/functions/_/index.js');
        const env = Object.freeze({ ...process.env });
        const edge = { 'x-forwarded-host': 'demo.vura.app', 'x-forwarded-proto': 'https' };
        const get = (p) => fn.fetch(new Request('http://10.1.2.3:3001' + p, { headers: edge }), env);
        const home = await get('/');
        const html = await home.text();
        const post = await get('/blog/hello-world');
        const missing = await get('/blog/nope');
        const webhook = await fn.fetch(new Request('http://10.1.2.3:3001/__what_revalidate', {
          method: 'POST', headers: { ...edge, 'content-type': 'application/json' }, body: '{"paths":["/"]}',
        }), env);
        console.log(JSON.stringify({
          home: home.status, cookie: home.headers.get('set-cookie'), listsPosts: html.includes('/blog/hello-world'),
          post: post.status, missing: missing.status, webhook: webhook.status,
        }));
      `);
      const run = spawnSync(process.execPath, [probe], {
        cwd: isolated,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, NODE_ENV: 'production' },
      });
      assert.equal(run.status, 0, `Function failed:\n${run.stdout}\n${run.stderr}`);
      const got = JSON.parse(run.stdout.trim().split('\n').pop());
      assert.equal(got.home, 200);
      assert.ok(got.listsPosts, 'SSR lists the posts');
      assert.match(got.cookie || '', /what-csrf=[^;]+;.*Secure/);
      assert.equal(got.post, 200);
      assert.equal(got.missing, 404);
      assert.equal(got.webhook, 404, 'no secret -> no webhook');
      assert.match(run.stderr + run.stdout, /WHAT_REVALIDATE_SECRET/, 'the Function warns about the missing secret');
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
