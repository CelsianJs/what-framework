/**
 * End to end: Chromium → the Vite plugin's pairing → bridge → MCP tools.
 *
 * Two fixture apps (test/fixture/app-a, app-b) on two dev servers, compiled
 * with what-compiler, with the devtools bootstrap injected by the real plugin.
 * Each test is a finding from the review that failed before and must hold:
 * page truth comes from page.evaluate, never from the tools themselves.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import what from 'what-compiler/vite';
import devtoolsPlugin from '../src/vite-plugin.js';
import { createBridge } from '../src/bridge.js';
import { freePortPair, connectTools } from './helpers/fake-page.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixture');
const REPO = resolve(here, '../../..');

// Skip gracefully when the Playwright browser isn't installed. The release
// gate sets WHAT_REQUIRE_BROWSER_TESTS=1 so a missing browser fails instead of
// silently shipping the bridge unverified.
let browserAvailable = false;
try {
  browserAvailable = existsSync(chromium.executablePath());
} catch {
  browserAvailable = false;
}
if (process.env.WHAT_REQUIRE_BROWSER_TESTS === '1' && !browserAvailable) {
  throw new Error('WHAT_REQUIRE_BROWSER_TESTS=1 but Chromium is not installed. Run `npx playwright install --with-deps chromium` before this suite.');
}
const e2eDescribe = browserAvailable ? describe : describe.skip;
if (!browserAvailable) console.warn('[what] Skipping devtools-mcp e2e: Chromium not installed (run `npx playwright install chromium`).');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

e2eDescribe('E2E: Chromium → Vite plugin pairing → bridge → MCP', () => {
  let bridge, tools, browser, pageA, urlA, urlB;
  const servers = [];

  async function serve(name, port) {
    const server = await createServer({
      configFile: false,
      root: join(FIXTURE, name),
      cacheDir: join(FIXTURE, 'node_modules', '.vite', name),
      plugins: [what(), devtoolsPlugin({ port })],
      server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [REPO] } },
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: 'error',
    });
    servers.push(server);
    await server.listen();
    return `http://127.0.0.1:${server.httpServer.address().port}`;
  }

  // Under a loaded test run the first discovery can miss; the client then
  // backs off for 10 s, so nudge it with its manual reconnect hook.
  async function connected(page, title) {
    for (let i = 0; i < 300; i++) {
      const status = (await tools.call('what_connection_status')).parsed;
      if (status.connected && (status.app?.title === `«${title}»` || status.sessions)) return status;
      if (i % 40 === 39) await page.evaluate(() => window.__WHAT_MCP_RECONNECT__?.());
      await pause(50);
    }
    throw new Error(`${title} never connected`);
  }

  before(async () => {
    let port;
    for (let attempt = 0; attempt < 5 && !bridge; attempt++) {
      port = await freePortPair();
      const candidate = createBridge({ port, projectRoot: FIXTURE, onError: () => {} });
      try {
        await candidate.ready;
        bridge = candidate;
      } catch {
        candidate.close();
      }
    }
    tools = await connectTools(bridge);
    urlA = await serve('app-a', port);
    urlB = await serve('app-b', port);
    browser = await chromium.launch({ headless: true });
    pageA = await browser.newPage();
    await pageA.goto(urlA);
    await pageA.locator('#add-form').waitFor();
    await connected(pageA, 'Review Todos');
  });

  after(async () => {
    try { await browser?.close(); } catch {}
    for (const s of servers) { try { await s.close(); } catch {} }
    try { await tools?.close(); } catch {}
    try { bridge?.close(); } catch {}
    rmSync(join(FIXTURE, 'node_modules'), { recursive: true, force: true });
  });

  const call = (name, args) => tools.call(name, args).then((r) => r.parsed);

  it('reports what happened before the bridge connected: a startup diagnostic and a startup effect error (major 3)', async () => {
    const status = await call('what_connection_status');
    assert.equal(status.session, 's1');
    assert.equal(status.diagnostics.ERR_MISSING_SIGNAL_READ, 1, JSON.stringify(status));
    assert.ok(status.issues.some((l) => l.startsWith('ERR_MISSING_SIGNAL_READ') && l.includes('displayTitle')), JSON.stringify(status.issues));
    assert.ok(status.issues.some((l) => l.includes('Startup todo effect failed')), JSON.stringify(status.issues));
    const errors = await call('what_errors');
    const startupError = errors.errors.find((e) => e.message.includes('Startup todo effect failed'));
    assert.equal(startupError.type, 'effect');
    assert.equal(startupError.effect, 'startupEffect#' + startupError.effect.split('#')[1]);
  });

  it('a coded hook error thrown in an event handler reaches what_errors with its fix (major 3)', async () => {
    const before = (await call('what_errors')).seq;
    await pageA.locator('#hook').click();
    const errors = await call('what_errors', { after: before });
    const hook = errors.errors.find((e) => e.code === 'ERR_HOOK_OUTSIDE_COMPONENT');
    assert.ok(hook, JSON.stringify(errors));
    assert.equal(hook.type, 'uncaught');
    assert.ok(errors.fixes.ERR_HOOK_OUTSIDE_COMPONENT);
  });

  it('the documented safe read returns the value without evaluating code (critical 5)', async () => {
    const answer = await call('what_eval', { code: 'document.title' });
    assert.deepEqual([answer.path, answer.type, answer.result], ['document.title', 'string', '«Review Todos»']);
    await pageA.evaluate(() => Object.defineProperty(document, 'title', { configurable: true, get() { window.__getterRan = true; return 'spoofed'; } }));
    const again = await call('what_eval', { code: 'window.document.title' });
    assert.equal(again.result, '«Review Todos»', 'the native accessor is used, not the page-defined getter');
    assert.equal(await pageA.evaluate(() => window.__getterRan === true), false);
    await pageA.evaluate(() => { delete document.title; });
    const refused = await tools.call('what_eval', { code: 'document.cookie' });
    assert.equal(refused.isError, true);
  });

  it('what_screenshot works on a plain local page in Chromium (major 9)', async () => {
    const { components } = await call('what_components', { filter: '^App$' });
    const result = await tools.client.callTool({ name: 'what_screenshot', arguments: { componentId: components[0].id } });
    assert.ok(!result.isError, result.content[0].text);
    const image = result.content.find((c) => c.type === 'image');
    assert.ok(image && image.data.length > 100);
  });

  it('a write is read back at once, and its events are exactly the action (critical 3, major 1)', async () => {
    const { signals } = await call('what_signals', { filter: '^refresh$' });
    const write = await call('what_set_signal', { signalId: signals[0].id, value: 99 });
    assert.ok(write.events.some((l) => / write refresh=99$/.test(l)), JSON.stringify(write.events));
    assert.ok(write.events.some((l) => / run .*← refresh#/.test(l)), 'the binding re-ran, caused by the write');
    const read = await call('what_signals', { id: signals[0].id });
    assert.equal(read.signals[0].value, 99);
    assert.equal(await pageA.locator('#refresh').textContent(), '99');
    const since = await call('what_events', { after: write.since, types: ['write', 'run'] });
    assert.deepEqual(since.events.slice(0, write.events.length), write.events);
  });

  it('rawString writes the exact string, and a circular value is replaced with an acknowledgement (critical 4)', async () => {
    const { signals } = await call('what_signals', { filter: '^(sample|circular)$' });
    const id = (name) => signals.find((s) => s.name === name).id;
    for (const raw of ['42', 'true', 'null', '[1,2]']) {
      await call('what_set_signal', { signalId: id('sample'), value: raw, rawString: true });
      assert.deepEqual(await pageA.evaluate(() => [typeof window.review.current().sample, window.review.current().sample]), ['string', raw]);
    }
    const replaced = await call('what_set_signal', { signalId: id('circular'), value: { closed: true } });
    assert.deepEqual(replaced.previous, { self: '[Circular]' });
    assert.deepEqual(replaced.current, { closed: true });
    assert.deepEqual(await pageA.evaluate(() => window.review.current().circular), { closed: true });
  });

  it('the registry is never truncated and a change past the preview is a change (critical 2)', async () => {
    await call('what_snapshot', { mode: 'save' });
    const { signals } = await call('what_signals', { filter: '^testLarge$' });
    await call('what_set_signal', { signalId: signals[0].id, value: Array.from({ length: 105 }, (_, i) => (i === 104 ? 999 : i)) });
    const diff = await call('what_snapshot', { mode: 'diff' });
    assert.ok(diff.signalsChanged?.some((s) => s.name === 'testLarge'), JSON.stringify(diff));
    await pageA.locator('#many').click();
    const found = await call('what_signals', { filter: '^bulk109$' });
    assert.deepEqual(found.signals.map((s) => s.value), [109]);
    const count = await pageA.evaluate(() => window.__WHAT_DEVTOOLS__.getState().signals.length);
    assert.equal(found.total, count);
  });

  it('names the effect that wrote a signal (engine API migration)', async () => {
    const { signals } = await call('what_signals', { filter: '^(source|derivedLength)$' });
    const id = (name) => signals.find((s) => s.name === name).id;
    await call('what_set_signal', { signalId: id('source'), value: 'hello', rawString: true });
    const trace = await call('what_signal_trace', { signalId: id('derivedLength') });
    const last = trace.writes.at(-1);
    assert.equal(last.to, 5);
    assert.match(last.by, /^syncLength#\d+$/);
  });

  it('reports the loop the engine stopped, naming the effect and the rounds (major 2)', async () => {
    const before = (await call('what_errors')).seq;
    const { signals } = await call('what_signals', { filter: '^startLoop$' });
    await call('what_set_signal', { signalId: signals[0].id, value: true });
    let loop;
    for (let i = 0; i < 20 && !loop; i++) {
      await pause(30);
      loop = (await call('what_errors', { after: before })).diagnostics.find((d) => d.code === 'ERR_INFINITE_EFFECT');
    }
    assert.ok(loop, 'ERR_INFINITE_EFFECT reached what_errors');
    assert.match(loop.message, /selfWritingEffect.*after 100 re-runs/);
    await call('what_set_signal', { signalId: signals[0].id, value: false });
  });

  it('navigation waits for the router, and reports browser and router state separately (major 9)', async () => {
    const nav = await call('what_navigate', { path: '/archive' });
    assert.equal(nav.settled, true, JSON.stringify(nav));
    assert.equal(nav.browser.path, '/archive');
    assert.equal(nav.router.path, '/archive');
    assert.equal(await pageA.locator('h2').textContent(), 'Archive', 'the view had changed when the answer came back');
    const route = await call('what_route');
    assert.deepEqual([route.browser.path, route.router.path, route.settled], ['/archive', '/archive', true]);
    await call('what_navigate', { path: '/' });
  });

  it('pages a diagnostic flood with a bounded answer and a loss watermark (major 6)', async () => {
    const before = (await call('what_errors')).seq;
    await pageA.locator('#diagnostic-flood').click();
    const result = await tools.call('what_errors', { after: before });
    assert.ok(result.content[0].text.length < 15_000, `${result.content[0].text.length} B`);
    // 505 distinct reports, 500 kept per session: the summary counts what is
    // kept and the loss watermark says the oldest were evicted.
    assert.equal(result.parsed.summary.ERR_MISSING_SIGNAL_READ, 500);
    assert.ok(result.parsed.lost.diagnosticsEvictedThrough > 0, JSON.stringify(result.parsed.lost));
    assert.equal(result.parsed.diagnostics.length, 20);
    assert.equal(result.parsed.more, 480);
  });

  it('a second app is refused and changes nothing for the first; a second tab is a second session (critical 1, 6, security #11)', async () => {
    const beforeA = await call('what_connection_status');
    const pageB = await browser.newPage();
    await pageB.goto(urlB);
    await pageB.locator('h1').waitFor();
    await pause(400);
    const status = await call('what_connection_status');
    assert.equal(status.session, 's1', 'still exactly one session: app B was not admitted');
    assert.deepEqual(status.counts, beforeA.counts, 'app A\'s state is unchanged');
    assert.ok(status.refused?.some((r) => r.origin === new URL(urlB).origin), JSON.stringify(status.refused));
    assert.ok(!(await call('what_errors')).errors.some((e) => e.message.includes('Other app')), 'nothing from app B reached app A');
    await pageB.close();

    const tab = await browser.newPage();
    await tab.goto(urlA);
    await tab.locator('#add-form').waitFor();
    let two;
    for (let i = 0; i < 60 && !two?.sessions; i++) { await pause(50); two = await call('what_connection_status'); }
    assert.deepEqual(two.sessions.map((s) => s.id).sort(), ['s1', 's2']);
    const ambiguous = await tools.call('what_signals');
    assert.equal(ambiguous.isError, true);
    await tab.close();
    let one;
    for (let i = 0; i < 40 && one?.session !== 's1'; i++) { await pause(50); one = await call('what_connection_status'); }
    assert.equal(one.session, 's1', 'closing the other tab left app A connected');
  });
});
