#!/usr/bin/env node
// Scaffold smoke test — proves `create-what` output actually works END TO END
// with the LOCAL packages (not whatever is on npm):
//
//   1. `npm pack` every workspace package into a temp dir.
//   2. Scaffold EVERY template (default SPA, SPA + React compat, SPA + StyleX,
//      --fullstack, --template=islands) with the local create-what, pointing
//      all what-* deps at the local tarballs.
//   3. `npm install` each app, then run it like a user would:
//        SPA       -> `npm run build` + `vite preview`  (production bundle)
//        React     -> `vite` dev server, then `npm run build` + `vite preview`
//        StyleX    -> `npm run build` + `vite preview`
//        fullstack -> `node server.js`                  (real SSR + ISR server)
//                     then `npm run build` (Vura output) and its Function
//        islands   -> `vite` dev server, then `npm run build` + `vite preview`
//   4. Assert over HTTP (and with a headless browser when available):
//        SPA       -> prod page renders the counter and it increments on click
//        React     -> dev and prod pages render, the signal counter and the
//                     zustand store both update, with no errors or warnings
//        StyleX    -> installs without --legacy-peer-deps, the built CSS has
//                     the StyleX rules, and the counter increments
//        fullstack -> / returns SSR HTML, /src/entry-client.js is served,
//                     second request is an ISR HIT, and the page HYDRATES
//                     (Like button increments; zero page errors)
//        islands   -> dev and built pages are server-rendered HTML, the island
//                     hydrates IN PLACE and increments, and a page with no
//                     islands loads only the entry script
//   5. `npm run lint` passes with no warnings in every app (the scaffolded
//      eslint config works and the generated code is clean).
//
// Offline vs registry: packing and the what-* packages are local; `npm
// install` fetches every other dependency (vite, eslint, typescript, zustand,
// StyleX, ...) from the npm registry, or npm's cache when it has them.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { islandServerRender, stripHydrationMarkup } from './lib/hydration-markup.mjs';

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
  'packages/react-compat': 'what-react',
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

// `answers` are typed into create-what's prompts (one per line); without them
// it scaffolds with --yes.
// Pages added to a scaffolded full-stack app: two that redirect on the server
// (/gate from its loader, /lab/dashboard from a <Router> middleware), and
// /pair, two editors of the template's savePostAction on one page.
function addSmokePages(appDir) {
  writeFileSync(join(appDir, 'src/pages/gate.js'), `import { h } from 'what-framework';
export const page = { mode: 'server' };
export const loader = ({ response }) => { response.redirect('/'); return {}; };
export default function Gate() { return h('main', {}, 'secret'); }
`);
  writeFileSync(join(appDir, 'src/pages/lab.js'), `import { h } from 'what-framework';
import { Router } from 'what-framework/router';
export const page = { mode: 'server' };
export const loader = () => ({});
const routes = [
  { path: '/lab/login', component: () => h('h2', {}, 'Log in') },
  { path: '/lab/dashboard', component: () => h('h2', {}, 'Dashboard'), middleware: [() => '/lab/login'] },
];
export default function Lab() { return h('main', {}, h(Router, { routes })); }
`);
  writeFileSync(join(appDir, 'src/pages/pair.js'), `import { h, useActionState, useLoaderData } from 'what-framework';
import { Form } from 'what-framework/server';
import { savePostAction } from '../components/post-actions.js';
export const page = { mode: 'server' };
export const loader = async () => {
  const { getPost } = await import('../db.js');
  return { posts: [getPost('hello-world'), getPost('why-signals')] };
};
function Editor({ post }) {
  const [state, save] = useActionState(savePostAction, null);
  return h(Form, { action: save, id: 'editor-' + post.slug },
    h('input', { type: 'hidden', name: 'slug', value: post.slug }),
    h('input', { name: 'title', defaultValue: () => state()?.fields?.title ?? post.title }),
    () => (state()?.error ? h('p', { role: 'alert' }, state().error) : null),
    h('button', { type: 'submit' }, 'Save'));
}
export default function Pair() {
  const { posts } = useLoaderData();
  return h('main', {}, ...posts.map((post) => h(Editor, { post })));
}
`);
  const routesFile = join(appDir, 'src/routes.js');
  const routes = readFileSync(routesFile, 'utf8');
  const patched = routes
    .replace("import './actions/posts.js';", "import './actions/posts.js';\nimport Gate, { loader as gateLoader, page as gatePage } from './pages/gate.js';\nimport Lab, { loader as labLoader, page as labPage } from './pages/lab.js';\nimport Pair, { loader as pairLoader, page as pairPage } from './pages/pair.js';")
    .replace('export const routes = [', "export const routes = [\n  { path: '/gate', component: Gate, loader: gateLoader, page: gatePage, mode: gatePage.mode },\n  { path: '/lab/:sub', component: Lab, loader: labLoader, page: labPage, mode: labPage.mode },\n  { path: '/pair', component: Pair, loader: pairLoader, page: pairPage, mode: pairPage.mode },");
  if (patched === routes) fail('smoke: could not add the smoke routes to src/routes.js');
  writeFileSync(routesFile, patched);
}

function scaffoldApp(workDir, name, tarballs, extraFlags = [], answers = null) {
  const createWhat = join(REPO, 'packages/create-what/index.js');
  if (answers === null) run(process.execPath, [createWhat, name, '--yes', ...extraFlags], { cwd: workDir });
  else run(process.execPath, [createWhat, name, ...extraFlags], { cwd: workDir, input: answers, stdio: ['pipe', 'pipe', 'inherit'] });
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

// `warnings: true` also counts console warnings, where development
// diagnostics are printed.
async function withPage(browser, url, fn, { warnings = false, javaScriptEnabled = true } = {}) {
  const context = javaScriptEnabled ? null : await browser.newContext({ javaScriptEnabled });
  const page = await (context ?? browser).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || (warnings && m.type() === 'warning')) errors.push(`console ${m.type()}: ${m.text()}`);
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await fn(page, errors);
  } finally {
    await page.close();
    if (context) await context.close();
  }
}

// The scaffold's own `npm run lint`, with a warning counted as a failure.
function lintClean(appDir) {
  run('npm', ['run', 'lint', '--', '--max-warnings', '0'], { cwd: appDir });
  log('  ok - npm run lint passes with no warnings');
}

function distText(appDir) {
  return readdirSync(join(appDir, 'dist'), { recursive: true })
    .map((f) => join(appDir, 'dist', f))
    .filter((p) => { try { return statSync(p).isFile(); } catch { return false; } })
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n');
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
  const bundle = distText(appDir);
  for (const needle of ['what-devtools', 'virtual:what-devtools', '__x00__', 'connectDevToolsMCP', '__what_mcp']) {
    assert(!bundle.includes(needle), `prod bundle contains NO devtools leak ("${needle}")`);
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

  lintClean(appDir);

  child.kill('SIGTERM');
}

// --- 3b. SPA + React compat --------------------------------------------------
//
// what-react renders the JSX and What's mount() renders the result. The dev
// server runs over real installs, which Vite pre-bundles unless told not to,
// so a second what-core shows there; the production build keeps core's vnode
// renderer only if what-react's own vnodes bring it in.

async function checkReactCompatPage(browser, url, label) {
  await withPage(browser, url, async (page, errors) => {
    // What the browser reported goes into the failure: a page that renders
    // nothing has usually thrown, and the checks below never get to say so.
    const rendered = (await page.innerHTML('#app')).includes('zustand-demo');
    assert(rendered, `${label}: the page renders the app and the zustand demo${rendered ? '' : ` (browser reported: ${errors.join('; ') || 'nothing'})`}`);
    await page.click('.counter button:last-of-type');
    await page.click('.counter button:last-of-type');
    await page.getByRole('button', { name: 'Add bear' }).click();
    await page.waitForFunction(() => document.querySelector('.zustand-count')?.textContent === '1 bears', null, { timeout: 5000 });
    const count = await page.textContent('.counter output');
    assert(count === '2', `${label}: the signal counter updates (0 -> ${count})`);
    assert((await page.textContent('.zustand-count')) === '1 bears', `${label}: the zustand store updates its component`);
    // react-router, added after scaffolding: it has a CommonJS-only
    // dependency (cookie), which the dev server must pre-bundle.
    assert((await page.textContent('#rr-out')) === 'home page', `${label}: react-router renders its first route`);
    await page.click('#rr-about');
    await page.waitForFunction(() => document.querySelector('#rr-out')?.textContent === 'about page', null, { timeout: 5000 });
    assert(true, `${label}: a react-router <Link> navigates`);
    await page.fill('.card input', 'ada');
    await page.waitForFunction(() => document.querySelector('.card h3')?.textContent === 'card: ada', null, { timeout: 5000 });
    assert(true, `${label}: a React component written in TypeScript handles its ChangeEvent`);
    assert(errors.length === 0, `${label}: no browser errors or warnings (got: ${errors.join('; ') || 'none'})`);
  }, { warnings: true });
}

// What a user adds to the React scaffold: a React library with a
// CommonJS-only dependency (react-router), an ordinary React component in
// TypeScript, a native TypeScript file that uses it, and a server entry.
function addReactSmokeFiles(appDir) {
  writeFileSync(join(appDir, 'src/Routed.jsx'), `import { MemoryRouter, Routes, Route, Link } from 'react-router';

export function Routed() {
  return (
    <MemoryRouter>
      <nav><Link id="rr-about" to="/about">about</Link></nav>
      <Routes>
        <Route path="/" element={<p id="rr-out">home page</p>} />
        <Route path="/about" element={<p id="rr-out">about page</p>} />
      </Routes>
    </MemoryRouter>
  );
}
`);
  // React + TypeScript as it is usually written: a forwardRef, CSSProperties,
  // a ChangeEvent handler, ReactNode children.
  writeFileSync(join(appDir, 'src/Card.tsx'), `/** @jsxImportSource react */
import { forwardRef, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, ReactNode } from 'react';

type CardProps = { title: string; children?: ReactNode; onPick?: (id: number) => void };

export const Field = forwardRef<HTMLInputElement, { label: string }>(function Field({ label }, ref) {
  return <label>{label}<input ref={ref} /></label>;
});

export function Card({ title, children, onPick }: CardProps) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const style: CSSProperties = { padding: 8, fontWeight: 600 };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => setText(e.target.value);
  return (
    <div className="card" style={style}>
      <h3>{title}: {text}</h3>
      <input value={text} onChange={onChange} />
      <Field ref={input} label="name" />
      <ul>{[1, 2, 3].map((id) => <li key={id} onClick={() => onPick?.(id)}>{id}</li>)}</ul>
      <button type="button" onClick={() => input.current?.focus()} disabled={text.length === 0}>focus</button>
      {children}
    </div>
  );
}
`);
  writeFileSync(join(appDir, 'src/Extras.tsx'), `import { signal } from 'what-framework';
import { Card } from './Card';
import { Routed } from './Routed.jsx';

const picked = signal(0);

export function Extras() {
  return (
    <section id="extras">
      <p id="picked">{picked()}</p>
      <Card title="card" onPick={(id) => picked(id)}><b>child</b></Card>
      <Routed />
    </section>
  );
}
`);
  writeFileSync(join(appDir, 'src/entry-server.jsx'), `import { h } from 'what-framework';
import { renderToHydratableString } from 'what-framework/server';
import { BearCounter } from './BearCounter.jsx';
import { Extras } from './Extras.tsx';

function Page() {
  return <main><BearCounter /><Extras /></main>;
}

export function render() {
  return renderToHydratableString(h(Page));
}
`);
  const mainFile = join(appDir, 'src/main.jsx');
  const main = readFileSync(mainFile, 'utf8');
  const patched = main
    .replace("import { BearCounter } from './BearCounter.jsx';", "import { BearCounter } from './BearCounter.jsx';\nimport { Extras } from './Extras.tsx';")
    .replace('<BearCounter />', '<BearCounter />\n      <Extras />');
  if (patched === main || !patched.includes('<Extras />')) fail('smoke: could not add <Extras /> to the React scaffold\'s src/main.jsx');
  writeFileSync(mainFile, patched);
}

async function smokeReactCompat(workDir, tarballs, browser) {
  log('--- SPA + React compat (dev server, production build) ---');
  // React compat is a prompt, not a flag: yes to it, then 1 (vanilla CSS).
  const appDir = scaffoldApp(workDir, 'smoke-react', tarballs, ['--template=spa'], 'y\n1\n');
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
  assert(Boolean(pkg.dependencies['what-react'] && pkg.dependencies.zustand), 'the scaffold depends on what-react and zustand');
  const viteBin = join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');

  // The scaffold as generated lints clean; what the smoke adds below is not
  // written to the scaffold's lint rules (a server bundle, a .tsx file).
  lintClean(appDir);

  run('npm', ['install', '--no-audit', '--no-fund', 'react-router@^7'], { cwd: appDir });
  addReactSmokeFiles(appDir);
  // An ordinary React component in a .tsx file, and a native .tsx file that
  // uses it, type-check as scaffolded.
  run('npm', ['run', 'typecheck'], { cwd: appDir });
  assert(true, 'tsc: a React .tsx file (React\'s types) and a native .tsx file (What\'s types) type-check');

  const devPort = PORT_BASE + 40;
  await assertPortFree(devPort);
  const dev = startProcess(process.execPath, [viteBin, '--port', String(devPort), '--strictPort'], {
    cwd: appDir,
    env: { ...process.env, BROWSER: 'none' },
  });
  const devBase = `http://localhost:${devPort}`;
  await waitForHttp(devBase + '/', { child: dev });
  const bootstrap = await fetch(devBase + '/@id/__x00__virtual:what-devtools-mcp/bootstrap');
  assert(bootstrap.ok, `dev: the devtools bootstrap is served (HTTP ${bootstrap.status})`);
  if (browser) {
    await checkReactCompatPage(browser, devBase + '/', 'dev');
    await withPage(browser, devBase + '/', async (page) => {
      const live = await page.waitForFunction(() => Boolean(globalThis.__WHAT_DEVTOOLS__), null, { timeout: 3000 }).then(() => true, () => false);
      assert(live, 'dev: devtools bridge is installed (window.__WHAT_DEVTOOLS__)');
    });
  }
  dev.kill('SIGTERM');

  run('npm', ['run', 'build'], { cwd: appDir });
  const bundle = distText(appDir);
  for (const needle of ['what-devtools', 'virtual:what-devtools', '__x00__', 'connectDevToolsMCP', '__what_mcp']) {
    assert(!bundle.includes(needle), `prod bundle contains NO devtools leak ("${needle}")`);
  }

  const previewPort = PORT_BASE + 41;
  await assertPortFree(previewPort);
  const preview = startProcess(process.execPath, [viteBin, 'preview', '--port', String(previewPort), '--strictPort'], { cwd: appDir });
  const previewBase = `http://localhost:${previewPort}`;
  await waitForHttp(previewBase + '/', { child: preview });
  if (browser) {
    await checkReactCompatPage(browser, previewBase + '/', 'prod');
  } else {
    // HTTP-only fallback: prove the bundle contains the compat app.
    assert(bundle.includes('zustand-demo'), 'built bundle contains the compat app (marker check)');
  }
  preview.kill('SIGTERM');

  // A production server build renders the React islands: one what-react in
  // the bundle (with a second copy every island comes out empty, silently).
  run(process.execPath, [viteBin, 'build', '--ssr', 'src/entry-server.jsx', '--outDir', 'dist-server'], { cwd: appDir });
  const entry = readdirSync(join(appDir, 'dist-server')).find((f) => /^entry-server\.m?js$/.test(f));
  assert(Boolean(entry), 'server build: wrote dist-server/entry-server.js');
  const html = run(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(pathToFileURL(join(appDir, 'dist-server', entry)).href)}); process.stdout.write(await m.render());`], {
    cwd: appDir,
    env: { ...process.env, NODE_ENV: 'production' },
  });
  assert(/class="zustand-count"[^>]*>0 bears</.test(html), `server build: the zustand island is in the server's HTML${/zustand-count/.test(html) ? '' : ` (got: ${html.slice(0, 300)})`}`);
  assert(html.includes('<p id="rr-out">home page</p>'), 'server build: the react-router island is in the server\'s HTML');
  assert(/<h3>card: <\/h3>/.test(html.replace(/<!--.*?-->/g, '')), 'server build: the TypeScript React component is in the server\'s HTML');
}

// --- 3c. SPA + StyleX ---------------------------------------------------------

async function smokeStylex(workDir, tarballs, browser) {
  log('--- SPA + StyleX (install, production build) ---');
  // No to React compat, then 3 (StyleX). scaffoldApp's plain `npm install`
  // fails with ERESOLVE if the StyleX packages disagree on their peers.
  const appDir = scaffoldApp(workDir, 'smoke-stylex', tarballs, ['--template=spa'], 'n\n3\n');
  const viteBin = join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');

  run('npm', ['run', 'build'], { cwd: appDir });
  const css = readdirSync(join(appDir, 'dist', 'assets')).filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(appDir, 'dist', 'assets', f), 'utf8')).join('\n');
  assert(/place-items:\s*center/.test(css), 'the built CSS carries the StyleX rules');

  const port = PORT_BASE + 50;
  await assertPortFree(port);
  const preview = startProcess(process.execPath, [viteBin, 'preview', '--port', String(port), '--strictPort'], { cwd: appDir });
  const base = `http://localhost:${port}`;
  await waitForHttp(base + '/', { child: preview });
  if (browser) {
    await withPage(browser, base + '/', async (page, errors) => {
      assert((await page.evaluate(() => getComputedStyle(document.querySelector('main')).display)) === 'grid', 'prod: StyleX styles apply');
      await page.getByRole('button', { name: '+' }).click();
      const after = await page.textContent('output');
      assert(after === '1', `prod: the counter increments (0 -> ${after})`);
      assert(errors.length === 0, `prod: no browser errors (got: ${errors.join('; ') || 'none'})`);
    });
  }
  preview.kill('SIGTERM');

  lintClean(appDir);
}

// --- 3d. Fullstack template ------------------------------------------------

async function smokeFullstack(workDir, tarballs, browser) {
  log('--- fullstack template (SSR + ISR + hydration) ---');
  const appDir = scaffoldApp(workDir, 'smoke-fullstack', tarballs, ['--fullstack']);
  addSmokePages(appDir);
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

  // A page is answered with the status and redirect its render set: a
  // loader's response.redirect(), a <Router> middleware's, a missing post's
  // 404 (server.js renders with what-server's own route renderer).
  const gate = await fetch(base + '/gate', { redirect: 'manual' });
  assert(gate.status === 302 && gate.headers.get('location') === '/', `a loader redirect answers 302 / (got ${gate.status} ${gate.headers.get('location')})`);
  const guarded = await fetch(base + '/lab/dashboard', { redirect: 'manual' });
  assert(guarded.status >= 300 && guarded.status < 400 && guarded.headers.get('location') === '/lab/login',
    `a <Router> middleware redirect answers a redirect to /lab/login (got ${guarded.status} ${guarded.headers.get('location')})`);
  assert((await fetch(base + '/blog/no-such-post')).status === 404, 'a missing post answers 404');

  // The editor's server validation without JavaScript: the form posts to the
  // editor itself, which renders the error next to the title as typed; a
  // valid title saves and answers 303 to the post.
  const editor = await (await fetch(base + '/edit/hello-world')).text();
  const editorKey = (/name="_actionKey" value="([^"]+)"/.exec(editor) || [])[1];
  assert(editor.includes('<input type="hidden" name="_action" value="savePost">') && editor.includes('<input type="hidden" name="_state" value="null">')
    && editorKey && !/<form[^>]*\saction=/.test(editor),
    'the editor posts the useActionState dispatch to its own page, with its state and its key');
  const postForm = (path, fields) => fetch(base + path, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' },
    body: new URLSearchParams({ _action: 'savePost', _state: 'null', ...fields }),
  });
  const typed = ' x' + ' '.repeat(8 * 1024);
  const invalid = await postForm('/edit/hello-world', { _actionKey: editorKey, slug: 'hello-world', title: typed });
  const invalidHtml = await invalid.text();
  assert(invalid.status === 200 && invalid.headers.get('cache-control') === 'private, no-store'
    && !(invalid.headers.get('set-cookie') || '').includes('what-as-'),
    `an invalid no-JS post renders the editor, private and cookie-free (got ${invalid.status} ${invalid.headers.get('cache-control')})`);
  assert(invalidHtml.includes('role="alert">Title needs three characters<') && invalidHtml.includes(`name="title" value="${typed}"`),
    'the editor renders the error and the 8 KB title exactly as typed');
  const valid = await postForm('/edit/why-signals', { _actionKey: editorKey, slug: 'why-signals', title: 'Why Signals' });
  assert(valid.status === 303 && valid.headers.get('location') === '/blog/why-signals',
    `a valid no-JS save answers 303 to the post (got ${valid.status} ${valid.headers.get('location')})`);

  // Two editors of the same action on one page: a post comes back to the
  // form that sent it, and the other keeps its own post's title.
  const pair = await (await fetch(base + '/pair')).text();
  const pairKeys = [...pair.matchAll(/name="_actionKey" value="([^"]+)"/g)].map((m) => m[1]);
  assert(pairKeys.length === 2 && pairKeys[0] !== pairKeys[1], `each editor on /pair has a key of its own (got ${pairKeys.join(', ')})`);
  const firstInvalid = await (await postForm('/pair', { _actionKey: pairKeys[0], slug: 'hello-world', title: 'x' })).text();
  const shownForms = [...firstInvalid.matchAll(/<form[^>]*id="editor-([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)]
    .map(([, slug, inner]) => [slug, (/role="alert">([^<]*)</.exec(inner) || [])[1] || '', (/name="title" value="([^"]*)"/.exec(inner) || [])[1]]);
  assert(JSON.stringify(shownForms) === JSON.stringify([['hello-world', 'Title needs three characters', 'x'], ['why-signals', '', 'Why Signals']]),
    `the first editor's error reaches it alone (got ${JSON.stringify(shownForms)})`);
  const secondSave = await postForm('/pair', { _actionKey: pairKeys[1], slug: 'why-signals', title: shownForms[1][2] });
  const firstPost = await (await fetch(base + '/blog/hello-world')).text();
  assert(secondSave.status === 303 && firstPost.includes('Hello, World'),
    `saving the second editor saves its own title and leaves the first post's (got ${secondSave.status})`);

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

    // The editor, in Chromium, with JavaScript off and on: the same error next
    // to the title as typed, then a save that lands on the post.
    for (const javaScriptEnabled of [false, true]) {
      const mode = javaScriptEnabled ? 'with JavaScript' : 'without JavaScript';
      await withPage(browser, base + '/edit/hello-world', async (page, errors) => {
        await page.fill('input[name=title]', ' x ');
        await page.click('button[type=submit]');
        await page.waitForSelector('[role=alert]', { timeout: 8000 });
        const alert = await page.textContent('[role=alert]');
        const title = await page.inputValue('input[name=title]');
        assert(new URL(page.url()).pathname === '/edit/hello-world' && alert === 'Title needs three characters' && title === ' x ',
          `the editor shows the server's validation error next to the title as typed ${mode} (got ${page.url()} "${alert}" "${title}")`);
        await page.fill('input[name=title]', 'Hello, World');
        await page.click('button[type=submit]');
        await page.waitForURL('**/blog/hello-world', { timeout: 8000 });
        assert((await page.textContent('article h1')) === 'Hello, World', `a save goes to the post ${mode}`);
        assert(errors.length === 0, `no browser errors in the editor ${mode} (got: ${errors.join('; ') || 'none'})`);
      }, { javaScriptEnabled });
    }
  }

  // Production without the revalidate secret: the app serves (a serverless
  // Function boots this same module on every cold start) and the webhook is
  // simply not mounted.
  const prodPort = PORT_BASE + 20;
  await assertPortFree(prodPort);
  const prod = startProcess(process.execPath, ['server.js'], {
    cwd: appDir,
    env: { ...process.env, NODE_ENV: 'production', WHAT_REVALIDATE_SECRET: '', PORT: String(prodPort) },
  });
  await waitForHttp(`http://localhost:${prodPort}/`, { child: prod });
  const webhook = await fetch(`http://localhost:${prodPort}/__what_revalidate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"paths":["/"]}',
  });
  assert(webhook.status === 404 && prod.logs.includes('WHAT_REVALIDATE_SECRET'), 'production without WHAT_REVALIDATE_SECRET serves, warns, and does not mount the webhook (404)');
  prod.kill('SIGTERM');

  // The scheduled warm-up runs as scaffolded: its renderer takes a match with
  // no request, and the entry it stores is the one the first visitor reads.
  // server.js again, with its 5-minute interval shortened and a line logged
  // when a scheduled regeneration is done, which the first visit waits for.
  const schedPort = PORT_BASE + 21;
  await assertPortFree(schedPort);
  const serverSource = readFileSync(join(appDir, 'server.js'), 'utf8');
  assert(serverSource.includes('{ intervalMs: 5 * 60 * 1000 }') && serverSource.includes('const scheduler = createScheduler(cache);'),
    'server.js registers the home page with the scheduler');
  writeFileSync(join(appDir, 'server-scheduled.js'), serverSource
    .replace('{ intervalMs: 5 * 60 * 1000 }', '{ intervalMs: 300 }')
    .replace('const scheduler = createScheduler(cache);', [
      'const scheduledRegenerate = cache.regenerate;',
      "cache.regenerate = async (route) => { const entry = await scheduledRegenerate(route); console.log('[smoke] scheduled regeneration done'); return entry; };",
      'const scheduler = createScheduler(cache);',
    ].join('\n')));
  const scheduled = startProcess(process.execPath, ['server-scheduled.js'], {
    cwd: appDir,
    env: { ...process.env, PORT: String(schedPort), NODE_ENV: 'development' },
  });
  try {
    const schedBase = `http://localhost:${schedPort}`;
    // Up, without a visit to /: the stylesheet is not a page.
    await waitForHttp(schedBase + '/src/styles.css', { child: scheduled });
    for (let i = 0; i < 120 && !scheduled.logs.includes('[smoke] scheduled regeneration done'); i++) {
      if (/scheduled regenerate failed/.test(scheduled.logs)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const warm = await fetch(schedBase + '/');
    await warm.text();
    assert(warm.headers.get('x-what-cache') === 'HIT', `the scheduler warmed / before its first visit (got ${warm.headers.get('x-what-cache')})`);
    assert(!/scheduled regenerate failed|TypeError/.test(scheduled.logs), `no scheduled tick failed (log: ${scheduled.logs.split('\n').find((l) => /failed|Error/.test(l)) || 'clean'})`);
  } finally {
    scheduled.kill('SIGTERM');
    rmSync(join(appDir, 'server-scheduled.js'), { force: true });
  }

  // `npm run build` writes Vura output, and the Function runs from dist/ alone
  // (no node_modules anywhere above it), the way the Vura runtime runs it.
  run('npm', ['run', 'build'], { cwd: appDir });
  const manifest = JSON.parse(readFileSync(join(appDir, 'dist', 'manifest.json'), 'utf8'));
  assert(
    manifest.schemaVersion === 1 && JSON.stringify(manifest.requiredFeatures) === '["api","function-compute"]',
    `Vura manifest is v1 with free-tier features only (got ${JSON.stringify(manifest.requiredFeatures)})`,
  );
  assert(existsSync(join(appDir, 'dist', 'static', 'src', 'entry-client.js')) && !existsSync(join(appDir, 'dist', 'static', 'src', 'db.js')), 'dist/static has the client entry and no server-only code');
  const isolated = mkdtempSync(join(tmpdir(), 'what-smoke-vura-fn-'));
  try {
    execFileSync('cp', ['-R', join(appDir, 'dist'), join(isolated, 'dist')]);
    writeFileSync(join(isolated, 'probe.mjs'), [
      "const { default: fn } = await import('./dist/functions/_/index.js');",
      "const res = await fn.fetch(new Request('http://internal/', { headers: { 'x-forwarded-host': 'smoke.vura.app' } }), {});",
      "console.log(res.status, (await res.text()).includes('__what_data'));",
    ].join('\n'));
    const out = run(process.execPath, [join(isolated, 'probe.mjs')], { cwd: isolated, env: { PATH: process.env.PATH, NODE_ENV: 'production' } });
    assert(out.trim().split('\n').pop() === '200 true', `the bundled Function renders / from dist/ alone (got ${out.trim()})`);
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }

  lintClean(appDir);

  child.kill('SIGTERM');
}

// --- 3e. Islands template -------------------------------------------------
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
  // The island's server render, read without the hydration protocol (data-hk
  // keys, <!--$--> markers) that every hydratable renderer writes since 0.15
  // (docs/UPGRADING.md, "Every hydratable server renderer writes one protocol").
  const serverRenderedCounter = '<output aria-live="polite">3</output>';
  const rendersCounter = (html) => (islandServerRender(html, 'counter') || '').includes(serverRenderedCounter);

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
  assert(rendersCounter(devHome), 'dev: the island is server-rendered inside its marker');
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
  assert(stripHydrationMarkup(homeHtml).includes('<h1>A static site with islands</h1>'), 'built Home page contains its server-rendered content');
  assert(rendersCounter(homeHtml), 'built Home page contains the island\'s server render');
  assert(/<script type="module" src="\/assets\/[^"]+\.js"><\/script>/.test(homeHtml), 'built Home page loads the hashed client entry');
  assert(aboutHtml.includes('<h1>About</h1>') && !aboutHtml.includes('data-island'), 'built About page is static HTML with no island');

  const bundle = distText(appDir);
  for (const needle of ['what-devtools', 'virtual:what-devtools', '__x00__', 'connectDevToolsMCP', '__what_mcp', '/@vite/client']) {
    assert(!bundle.includes(needle), `static build contains NO dev-only code ("${needle}")`);
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

  lintClean(appDir);
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

  // --only=react,islands runs some of the templates (all of them by default).
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;
  const templates = { spa: smokeSpa, react: smokeReactCompat, stylex: smokeStylex, fullstack: smokeFullstack, islands: smokeIslands };
  for (const name of only || []) if (!templates[name]) fail(`--only=${name}: expected ${Object.keys(templates).join(', ')}`);
  for (const [name, smoke] of Object.entries(templates)) {
    if (only === null || only.includes(name)) await smoke(workDir, tarballs, browser);
  }

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
