#!/usr/bin/env node
// Scaffold smoke test — proves `create-what` output actually works END TO END
// with the LOCAL packages (not whatever is on npm):
//
//   1. `npm pack` every workspace package into a temp dir.
//   2. Scaffold EVERY template (default SPA, --fullstack, --template=islands)
//      with the local create-what, pointing all what-* deps at the local
//      tarballs.
//   3. `npm install` each app, then run it like a user would:
//        SPA       -> `npm run build` + `vite preview`  (production bundle)
//        fullstack -> `node server.js`                  (real SSR + ISR server)
//        islands   -> `vite` dev server, then `npm run build` + `vite preview`
//   4. Assert over HTTP (and with a headless browser when available):
//        SPA       -> prod page renders the counter and it increments on click
//        fullstack -> / returns SSR HTML, /src/entry-client.js is served,
//                     second request is an ISR HIT, and the page HYDRATES
//                     (Like button increments; zero page errors)
//        islands   -> dev and built pages are server-rendered HTML, the island
//                     hydrates IN PLACE and increments, and a page with no
//                     islands loads only the entry script
//   5. `npm run lint` passes in every app (scaffolded eslint config works).
//
// Usage:  node scripts/smoke-scaffold.mjs          (or `npm run smoke:scaffold`)
// Ports:  4500-4599 (override base with WHAT_SMOKE_PORT_BASE)
// Env:    WHAT_SMOKE_REQUIRE_BROWSER=1  -> fail instead of falling back to
//         HTTP-only hydration markers when Chromium can't launch (set in CI).
//         WHAT_SMOKE_KEEP=1             -> keep the temp dir for inspection.
//
// Exits non-zero on any failure; all spawned processes are killed on exit.

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT_BASE = Number(process.env.WHAT_SMOKE_PORT_BASE) || 4500; // 4500-4599 reserved for this script
const REQUIRE_BROWSER = process.env.WHAT_SMOKE_REQUIRE_BROWSER === '1';

// Workspace dir -> published package name. Everything a scaffolded app can
// reach (directly or transitively) must be here so npm never falls back to
// the registry for what-* packages.
const LOCAL_PACKAGES = {
  'packages/what': 'what-framework',
  'packages/core': 'what-core',
  'packages/router': 'what-router',
  'packages/server': 'what-server',
  'packages/compiler': 'what-compiler',
  'packages/cache': 'what-isr',
  'packages/devtools': 'what-devtools',
  'packages/devtools-mcp': 'what-devtools-mcp',
  'packages/eslint-plugin': 'eslint-plugin-what',
};

const children = new Set();
let failed = false;

function log(msg) { console.log(`[smoke] ${msg}`); }
function fail(msg) {
  console.error(`[smoke] FAIL: ${msg}`);
  failed = true;
  const err = new Error(msg);
  err.smoke = true; // already reported above
  throw err;
}
function assert(cond, msg) { if (!cond) fail(msg); else log(`  ok - ${msg}`); }

function cleanup() {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch {}
  }
  children.clear();
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { cleanup(); process.exit(1); });
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts });
}

function startProcess(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  child.logs = '';
  child.stdout.on('data', (d) => { child.logs += d; });
  child.stderr.on('data', (d) => { child.logs += d; });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

// A stale process answering on our port makes every downstream assert lie
// (it serves a DIFFERENT app). Refuse to start if anything already responds.
async function assertPortFree(port) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) });
  } catch {
    return; // connection refused/timeout -> free
  }
  fail(`port ${port} is already in use - kill the stale process first (lsof -nP -iTCP:${port} -sTCP:LISTEN)`);
}

async function waitForHttp(url, { timeoutMs = 20000, child } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      fail(`process exited (${child.exitCode}) before ${url} was up:\n${child.logs}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`timed out waiting for ${url}${child ? `\n--- process logs ---\n${child.logs}` : ''}`);
}

// --- 1. Pack local packages ---------------------------------------------

function packLocalPackages(tarballDir) {
  mkdirSync(tarballDir, { recursive: true });
  const tarballs = {}; // package name -> absolute tarball path
  for (const [dir, name] of Object.entries(LOCAL_PACKAGES)) {
    const out = run('npm', ['pack', join(REPO, dir), '--pack-destination', tarballDir, '--silent']);
    const file = out.trim().split('\n').pop();
    tarballs[name] = join(tarballDir, file);
    if (!existsSync(tarballs[name])) fail(`npm pack of ${name} did not produce ${file}`);
  }
  log(`packed ${Object.keys(tarballs).length} local packages`);
  return tarballs;
}

// --- 2. Scaffold + install -----------------------------------------------

function scaffoldApp(workDir, name, tarballs, extraFlags = []) {
  run(process.execPath, [join(REPO, 'packages/create-what/index.js'), name, '--yes', ...extraFlags], { cwd: workDir });
  const appDir = join(workDir, name);

  // Point every what-* dependency at the local tarballs. `overrides` covers
  // the transitive deps (what-framework -> what-core/router/server/compiler)
  // so nothing resolves from the npm registry.
  const pkgPath = join(appDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  for (const section of ['dependencies', 'devDependencies']) {
    for (const dep of Object.keys(pkg[section] || {})) {
      if (tarballs[dep]) pkg[section][dep] = `file:${tarballs[dep]}`;
    }
  }
  pkg.overrides = Object.fromEntries(Object.entries(tarballs).map(([n, f]) => [n, `file:${f}`]));
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

  run('npm', ['install', '--no-audit', '--no-fund'], { cwd: appDir });
  log(`scaffolded + installed ${name}`);
  return appDir;
}

// --- Headless browser (optional but preferred) ----------------------------

async function launchBrowser() {
  try {
    const { chromium } = await import('playwright');
    return await chromium.launch();
  } catch (err) {
    if (REQUIRE_BROWSER) fail(`WHAT_SMOKE_REQUIRE_BROWSER=1 but Chromium failed to launch: ${err.message}`);
    log(`  warn - headless browser unavailable (${err.message.split('\n')[0]}); falling back to HTTP-only checks`);
    return null;
  }
}

async function withPage(browser, url, fn) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await fn(page, errors);
  } finally {
    await page.close();
  }
}

// --- 3a. Default (SPA) template -------------------------------------------

async function smokeSpa(workDir, tarballs, browser) {
  log('--- default template (SPA, production build) ---');
  const appDir = scaffoldApp(workDir, 'smoke-spa', tarballs);
  const port = PORT_BASE;

  run('npm', ['run', 'build'], { cwd: appDir });
  assert(existsSync(join(appDir, 'dist', 'index.html')), 'vite build produced dist/index.html');

  // The scaffold wires up `whatDevTools()` (what-devtools-mcp/vite-plugin) — a
  // DEV-ONLY plugin. A production build must carry ZERO devtools/MCP code: a
  // past regression shipped the dev bootstrap into prod, so the page requested
  // `virtual:what-devtools-mcp/bootstrap` (500) and could follow a live local
  // dev server to localhost. Grep the whole built bundle to prove it's clean.
  const distText = readdirSync(join(appDir, 'dist'), { recursive: true })
    .map((f) => join(appDir, 'dist', f))
    .filter((p) => { try { return statSync(p).isFile(); } catch { return false; } })
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
  for (const needle of ['what-devtools', 'virtual:what-devtools', '__x00__', 'connectDevToolsMCP', '__what_mcp']) {
    assert(!distText.includes(needle), `prod bundle contains NO devtools leak ("${needle}")`);
  }

  await assertPortFree(port);
  const viteBin = join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = startProcess(process.execPath, [viteBin, 'preview', '--port', String(port), '--strictPort'], { cwd: appDir });
  const base = `http://localhost:${port}`;
  await waitForHttp(base + '/', { child });

  const html = await (await fetch(base + '/')).text();
  assert(html.includes('<div id="app">'), 'prod index.html has the #app mount point');
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert(!!asset, 'prod index.html references a built JS asset');
  const js = await (await fetch(base + asset)).text();
  assert((await fetch(base + asset)).ok, `built asset ${asset} is served`);

  if (browser) {
    await withPage(browser, base + '/', async (page, errors) => {
      const appHtml = await page.innerHTML('#app');
      assert(appHtml.includes('<button'), 'prod page RENDERS the counter markup (no blank screen)');
      const before = await page.textContent('.counter output');
      await page.click('.counter button:last-of-type'); // the "+" button
      const after = await page.textContent('.counter output');
      assert(before === '0' && after === '1', `counter increments on click (${before} -> ${after})`);
      assert(errors.length === 0, `no browser errors (got: ${errors.join('; ') || 'none'})`);
    });
  } else {
    // HTTP-only fallback: prove the bundle contains the counter app.
    assert(/counter/.test(js) && /signal|mount/.test(html + js), 'built bundle contains the counter app (marker check)');
  }

  run('npm', ['run', 'lint'], { cwd: appDir });
  log('  ok - npm run lint passes');

  child.kill('SIGTERM');
}

// --- 3b. Fullstack template ------------------------------------------------

async function smokeFullstack(workDir, tarballs, browser) {
  log('--- fullstack template (SSR + ISR + hydration) ---');
  const appDir = scaffoldApp(workDir, 'smoke-fullstack', tarballs, ['--fullstack']);
  const port = PORT_BASE + 10;

  await assertPortFree(port);
  const child = startProcess(process.execPath, ['server.js'], {
    cwd: appDir,
    env: { ...process.env, PORT: String(port), NODE_ENV: '' },
  });
  const base = `http://localhost:${port}`;
  await waitForHttp(base + '/', { child });
  if (child.exitCode !== null) fail(`fullstack server exited early (${child.exitCode}):\n${child.logs}`);

  // SSR document
  const first = await fetch(base + '/');
  const html = await first.text();
  assert(first.status === 200, 'GET / returns 200');
  assert(html.includes('id="__what_data"'), 'SSR HTML embeds the hydration payload (#__what_data)');
  assert(html.includes('src="/src/entry-client.js"'), 'SSR HTML references the client entry script');
  assert(html.includes('Server-rendered'), 'SSR HTML contains server-rendered page markup');
  assert(html.includes('type="importmap"'), 'SSR HTML injects the import map for bare module specifiers');

  // Client entry + framework modules are actually served
  const entry = await fetch(base + '/src/entry-client.js');
  assert(entry.status === 200, 'client entry /src/entry-client.js returns 200');
  const entrySrc = await entry.text();
  assert(entrySrc.includes('hydrate('), 'client entry calls hydrate() (hydration marker)');
  assert((await fetch(base + '/node_modules/what-framework/src/index.js')).status === 200, 'framework module is served for the import map');
  assert((await fetch(base + '/src/styles.css')).status === 200, 'stylesheet is served');

  // ISR: second request must be a cache HIT
  const second = await fetch(base + '/');
  assert(second.headers.get('x-what-cache') === 'HIT', `second request is an ISR HIT (got ${second.headers.get('x-what-cache')})`);

  if (browser) {
    // The page actually hydrates: the Like button works.
    await withPage(browser, base + '/', async (page, errors) => {
      const before = await page.textContent('.like-demo output');
      await page.click('.like-demo button');
      await page.click('.like-demo button');
      const after = await page.textContent('.like-demo output');
      assert(before === '0' && after === '2', `page hydrates - Like button increments (${before} -> ${after})`);
      assert(errors.length === 0, `no browser errors during hydration (got: ${errors.join('; ') || 'none'})`);

      // The headline differentiator has to be ALIVE in a scaffolded app, not
      // merely configured. For months every scaffold shipped .mcp.json,
      // .cursor/mcp.json and an MCP-promising CLAUDE.md while omitting the one
      // devDependency that makes the tools answer, and nothing failed, because
      // no gate asserted the bridge was actually installed. This is that gate.
      // It is deliberately checked on the buildless fullstack template, which
      // has no Vite plugin and therefore the easiest wiring to break.
      const devtoolsLive = await page.evaluate(
        () => new Promise((res) => {
          // installDevTools runs after a dynamic import chain, so poll briefly.
          let n = 0;
          const t = setInterval(() => {
            if (globalThis.__WHAT_DEVTOOLS__ || ++n > 40) { clearInterval(t); res(!!globalThis.__WHAT_DEVTOOLS__); }
          }, 50);
        }),
      );
      assert(devtoolsLive, 'devtools bridge is installed in the scaffolded app (window.__WHAT_DEVTOOLS__)');

      const snapshot = await page.evaluate(() => {
        try { return globalThis.__WHAT_DEVTOOLS__.getSnapshot(); } catch { return null; }
      });
      assert(snapshot && Array.isArray(snapshot.signals), 'devtools reports a real reactive snapshot');
      assert(snapshot.signals.length > 0, `devtools sees the app's signals (got ${snapshot ? snapshot.signals.length : 0})`);
    });

    // Server action round-trip: create a post via the enhanced form.
    await withPage(browser, base + '/new', async (page, errors) => {
      await page.fill('input[name=title]', 'Smoke Post');
      await page.fill('textarea[name=body]', 'Created by smoke-scaffold.');
      await page.click('button[type=submit]');
      await page.waitForURL('**/blog/smoke-post', { timeout: 8000 });
      assert((await page.textContent('article h1')) === 'Smoke Post', 'server action creates the post and redirects to it');
      assert(errors.length === 0, `no browser errors during action submit (got: ${errors.join('; ') || 'none'})`);
    });
    const home = await (await fetch(base + '/')).text();
    assert(home.includes('Smoke Post'), 'action revalidated the cached home page (new post listed)');
  }

  // Production guard: server must refuse to start without the revalidate secret.
  const prod = startProcess(process.execPath, ['server.js'], {
    cwd: appDir,
    env: { ...process.env, NODE_ENV: 'production', WHAT_REVALIDATE_SECRET: '', PORT: String(PORT_BASE + 20) },
  });
  const prodExit = await new Promise((r) => { prod.on('exit', r); setTimeout(() => r(null), 8000); });
  assert(prodExit === 1 && prod.logs.includes('WHAT_REVALIDATE_SECRET'), 'production start without WHAT_REVALIDATE_SECRET exits 1 with a clear error');

  run('npm', ['run', 'lint'], { cwd: appDir });
  log('  ok - npm run lint passes');

  child.kill('SIGTERM');
}

// --- 3c. Islands template -------------------------------------------------
//
// JSX pages prerendered to static HTML, with one island hydrated in place. The
// claims that matter are only observable together: the page is complete HTML
// before any script runs, the island adopts that HTML rather than replacing it,
// and a page without islands never loads the island runtime.

async function waitForIslandHydration(page) {
  // hydrateIslands() strips data-island from the host once it has hydrated.
  await page.waitForSelector('[data-island]', { state: 'detached', timeout: 15000 });
}

async function smokeIslands(workDir, tarballs, browser) {
  log('--- islands template (static pages + island hydration) ---');
  const appDir = scaffoldApp(workDir, 'smoke-islands', tarballs, ['--template=islands']);
  const viteBin = join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const serverRenderedCounter = '<output aria-live="polite">3</output>';

  // Dev server: pages are rendered on request by the scaffold's own plugin.
  const devPort = PORT_BASE + 30;
  await assertPortFree(devPort);
  const dev = startProcess(process.execPath, [viteBin, '--port', String(devPort), '--strictPort'], {
    cwd: appDir,
    env: { ...process.env, BROWSER: 'none' },
  });
  const devBase = `http://localhost:${devPort}`;
  await waitForHttp(devBase + '/', { child: dev });

  const devHome = await (await fetch(devBase + '/')).text();
  assert(devHome.includes('<title>Home | smoke-islands</title>'), 'dev: GET / renders the Home page with its <Head> title');
  assert(devHome.includes('data-island="counter"'), 'dev: the page carries the island marker');
  assert(devHome.includes(serverRenderedCounter), 'dev: the island is server-rendered inside its marker');
  assert(devHome.includes('src="/src/entry-client.js"'), 'dev: the page loads the client entry');
  const devAbout = await fetch(devBase + '/about');
  assert(devAbout.status === 200 && (await devAbout.text()).includes('<title>About | smoke-islands</title>'), 'dev: GET /about renders the About page');

  if (browser) {
    await withPage(browser, devBase + '/', async (page, errors) => {
      await waitForIslandHydration(page);
      await page.click('.counter button[aria-label="Increase"]');
      const after = await page.textContent('.counter output');
      assert(after === '4', `dev: the island hydrates and responds to a click (3 -> ${after})`);
      const devtoolsLive = await page.evaluate(
        () => new Promise((res) => {
          let n = 0;
          const t = setInterval(() => {
            if (globalThis.__WHAT_DEVTOOLS__ || ++n > 60) { clearInterval(t); res(!!globalThis.__WHAT_DEVTOOLS__); }
          }, 50);
        }),
      );
      assert(devtoolsLive, 'dev: devtools bridge is installed (window.__WHAT_DEVTOOLS__)');
      assert(errors.length === 0, `dev: no browser errors (got: ${errors.join('; ') || 'none'})`);
    });
  }
  dev.kill('SIGTERM');

  // Static build: every route written as a complete HTML file.
  run('npm', ['run', 'build'], { cwd: appDir });
  const homeFile = join(appDir, 'dist', 'index.html');
  const aboutFile = join(appDir, 'dist', 'about', 'index.html');
  assert(existsSync(homeFile) && existsSync(aboutFile), 'build wrote dist/index.html and dist/about/index.html');
  assert(!existsSync(join(appDir, '.ssr')) && !existsSync(join(appDir, 'dist', '.vite')), 'build removed its temporary server bundle and manifest');
  const homeHtml = readFileSync(homeFile, 'utf8');
  const aboutHtml = readFileSync(aboutFile, 'utf8');
  assert(homeHtml.includes('<h1>A static site with islands</h1>'), 'built Home page contains its server-rendered content');
  assert(homeHtml.includes(serverRenderedCounter), 'built Home page contains the island\'s server render');
  assert(/<script type="module" src="\/assets\/[^"]+\.js"><\/script>/.test(homeHtml), 'built Home page loads the hashed client entry');
  assert(aboutHtml.includes('<h1>About</h1>') && !aboutHtml.includes('data-island'), 'built About page is static HTML with no island');

  const distText = readdirSync(join(appDir, 'dist'), { recursive: true })
    .map((f) => join(appDir, 'dist', f))
    .filter((p) => { try { return statSync(p).isFile(); } catch { return false; } })
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
  for (const needle of ['what-devtools', 'virtual:what-devtools', '__x00__', 'connectDevToolsMCP', '__what_mcp', '/@vite/client']) {
    assert(!distText.includes(needle), `static build contains NO dev-only code ("${needle}")`);
  }

  // Served the way a static host serves it.
  const previewPort = PORT_BASE + 31;
  await assertPortFree(previewPort);
  const preview = startProcess(process.execPath, [viteBin, 'preview', '--port', String(previewPort), '--strictPort'], { cwd: appDir });
  const previewBase = `http://localhost:${previewPort}`;
  await waitForHttp(previewBase + '/', { child: preview });
  assert((await fetch(previewBase + '/about')).status === 200, 'preview serves /about from dist/about/index.html');

  if (browser) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    // Keep a reference to the button the HTML parser created, taken before any
    // page script can run, so "hydrated in place" is checked against the
    // server's node rather than against whatever is in the DOM afterwards.
    await page.addInitScript(() => {
      new MutationObserver((_, observer) => {
        const b = document.querySelector('.counter button[aria-label="Increase"]');
        if (b) { globalThis.__serverButton = b; observer.disconnect(); }
      }).observe(document, { childList: true, subtree: true });
    });
    try {
      await page.goto(previewBase + '/', { waitUntil: 'networkidle', timeout: 15000 });
      await waitForIslandHydration(page);
      const adopted = await page.evaluate(() => {
        const live = document.querySelector('.counter button[aria-label="Increase"]');
        return !!globalThis.__serverButton && globalThis.__serverButton === live && live.isConnected;
      });
      assert(adopted, 'the island hydrated in place: the server-rendered button is the live one');
      await page.click('.counter button[aria-label="Increase"]');
      await page.click('.counter button[aria-label="Increase"]');
      const after = await page.textContent('.counter output');
      assert(after === '5', `built page: the island is interactive (3 -> ${after})`);
      assert(errors.length === 0, `built page: no browser errors (got: ${errors.join('; ') || 'none'})`);
    } finally {
      await page.close();
    }

    const scripts = [];
    const aboutPage = await browser.newPage();
    aboutPage.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname); });
    try {
      await aboutPage.goto(previewBase + '/about', { waitUntil: 'networkidle', timeout: 15000 });
    } finally {
      await aboutPage.close();
    }
    assert(scripts.length === 1, `a page with no islands loads only the entry script (got: ${scripts.join(', ')})`);
  }
  preview.kill('SIGTERM');

  run('npm', ['run', 'lint'], { cwd: appDir });
  log('  ok - npm run lint passes');
}

// --- Main -------------------------------------------------------------------

const workDir = mkdtempSync(join(tmpdir(), 'what-smoke-'));
log(`work dir: ${workDir}`);

let browser = null;
try {
  // The SPA production build resolves the `production` export condition to
  // dist/*.min.js inside the tarballs — make sure the repo is built.
  if (!existsSync(join(REPO, 'packages/what/dist/index.min.js'))) {
    fail('packages/what/dist is missing - run `npm run build` at the repo root first');
  }

  const tarballs = packLocalPackages(join(workDir, 'tarballs'));
  browser = await launchBrowser();

  await smokeSpa(workDir, tarballs, browser);
  await smokeFullstack(workDir, tarballs, browser);
  await smokeIslands(workDir, tarballs, browser);

  log('ALL SCAFFOLD SMOKE CHECKS PASSED');
} catch (err) {
  failed = true;
  if (!err?.smoke) console.error(err);
} finally {
  if (browser) await browser.close().catch(() => {});
  cleanup();
  if (process.env.WHAT_SMOKE_KEEP === '1') log(`kept work dir: ${workDir}`);
  else rmSync(workDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
