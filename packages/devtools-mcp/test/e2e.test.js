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
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import what from 'what-compiler/vite';
import devtoolsPlugin from '../src/vite-plugin.js';
import { createBridge } from '../src/bridge.js';
import { registerAgentTools } from '../src/tools-agent.js';
import { freePortPair, connectTools } from './helpers/fake-page.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixture');
const REPO = resolve(here, '../../..');

// Skip gracefully when the Playwright browser isn't installed. The release
// gate sets WHAT_REQUIRE_BROWSER_TESTS=1 so a missing browser fails instead of
// silently shipping the bridge unverified.
const browserAvailable = await chromiumLaunches(chromium);
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
    registerAgentTools(tools.server, bridge);
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

  it('explains an equal computed skip and the entire click-to-DOM chain by selector or id', async () => {
    const { effects } = await call('what_effects', { filter: '^writeResult$' });
    const writer = effects[0];
    assert.match(writer.owner, /<App>.*<DiagnosticsExample>/);
    assert.match(writer.loc, /diagnostics\.jsx:\d+:\d+$/);
    const writerId = writer.id;
    await pageA.locator('#cause-click').click();
    const equal = await call('what_why', { effectId: writerId });
    assert.equal(equal.graph[0].kind, 'skip', JSON.stringify(equal));
    assert.ok(equal.graph.some((step) => step.kind === 'equal' && step.subject.name === 'equal'), JSON.stringify(equal));
    assert.equal(await pageA.locator('#cause-output').textContent(), 'value: 0');

    await pageA.locator('#cause-click').click();
    const why = await call('what_why', { selector: '#cause-output' });
    assert.equal(why.targets.length, 2, JSON.stringify(why));
    assert.equal(await pageA.locator('#cause-output').textContent(), 'value: 1');
    assert.ok(why.targets.every((target) => target.kind === 'binding' && target.reads.some((read) => read.name === 'writtenByEffect')));
    const expected = ['writtenByEffect', 'writeResult', 'formatted', 'equal', 'count'];
    assert.ok(expected.every((name) => why.graph.some((step) => step.subject.name === name)), JSON.stringify(why));
    const origin = why.graph.find((step) => step.origin?.kind === 'event')?.origin;
    assert.equal(origin?.event, 'click', JSON.stringify(why));
    assert.match(origin.loc, /diagnostics\.jsx:\d+:\d+$/);
    const byBinding = await call('what_why', { bindingId: why.targets[0].id });
    assert.equal(byBinding.targets[0].id, why.targets[0].id);
    const byComponent = await call('what_why', { componentId: why.target.componentId });
    assert.ok(byComponent.targets.some((target) => target.id === writerId));
    assert.ok((await call('what_why', { effectId: writerId, selector: '#cause-output' })).error);

    const { signals } = await call('what_signals', { filter: '^count$' });
    const count = signals.find((entry) => entry.owner?.includes('<DiagnosticsExample>'));
    await call('what_set_signal', { signalId: count.id, value: 4 });
    const fromMcp = await call('what_why', { effectId: writerId });
    assert.ok(fromMcp.graph.some((step) => step.origin?.kind === 'what_set_signal'), JSON.stringify(fromMcp));
  });

  it('reports unsettled work and explains async landings and transition commits', async () => {
    const stuck = await call('what_diagnose', { focus: 'async', pendingMs: 0 });
    assert.ok(stuck.stalled.work.some((entry) => entry.kind === 'async' && entry.name === 'result'));
    assert.ok(stuck.stalled.work.some((entry) => entry.kind === 'suspense'));
    const pending = await call('what_signals', { filter: '^result$' });
    assert.equal(pending.signals[0].async.status, 'unresolved');
    assert.equal(pending.signals[0].async.inFlight.run, 1);
    assert.ok(pending.signals[0].async.inFlight.startedAt > 0);
    await pageA.locator('#land').click();
    assert.equal(await pageA.locator('#async-value').textContent(), '0');
    const landing = await call('what_why', { selector: '#async-value' });
    assert.ok(landing.graph.some((step) => step.kind === 'async-landing'), JSON.stringify(landing));
    const first = await call('what_events', { after: stuck.seq, types: ['async', 'suspense'] });
    assert.ok(first.work.some((event) => event.type === 'async:land' && event.run === 1));
    assert.ok(first.work.some((event) => event.type === 'suspense:revealed'));

    await pageA.locator('#hold').click();
    const held = await call('what_diagnose', { focus: 'async', pendingMs: 0 });
    assert.ok(held.stalled.work.some((entry) => entry.kind === 'transition'));
    await pageA.locator('#land').click();
    assert.equal(await pageA.locator('#async-value').textContent(), '1');
    const commit = await call('what_why', { selector: '#async-value' });
    assert.ok(commit.graph.some((step) => step.kind === 'transition-commit'), JSON.stringify(commit));
    assert.ok(commit.graph.some((step) => step.kind === 'async-landing'));
    const events = await call('what_events', { after: first.seq, types: ['transition', 'optimistic'] });
    const types = events.work.map((event) => event.type);
    assert.deepEqual(types, ['transition:open', 'optimistic:add', 'transition:commit', 'optimistic:drop']);
    assert.ok(events.work.find((event) => event.type === 'transition:commit').heldCount > 0);
    assert.equal((await call('what_diagnose', { focus: 'async', pendingMs: 0 })).stalled, undefined);
  });

  it('reports the adopted tree and each hydration mismatch as structured data', async () => {
    const before = await call('what_connection_status');
    assert.equal(before.hydration.hydrated, false);
    await pageA.locator('#hydrate-mismatch').click();
    assert.equal(await pageA.locator('#hydrate-target').textContent(), 'clientnew');
    const errors = await call('what_errors', { code: 'ERR_HYDRATION_MISMATCH', after: before.seq });
    const mismatch = errors.diagnostics.find((item) => item.mismatch.kind === 'text');
    assert.ok(mismatch.owner.includes('<HydrationMismatch>'), JSON.stringify(errors));
    assert.match(mismatch.loc, /diagnostics\.jsx:\d+:\d+$/);
    assert.match(mismatch.mismatch.path, /p.*#text/);
    assert.match(mismatch.mismatch.found, /«.*server.*»/);
    assert.match(mismatch.mismatch.expected, /«.*client.*»/);
    assert.equal(mismatch.mismatch.recovery, 'client-render');
    const after = await call('what_connection_status');
    assert.deepEqual(after.hydration, { hydrated: true, adopted: 2, created: 2 });
    const fix = await call('what_fix', { error: 'ERR_HYDRATION_MISMATCH', kind: 'text' });
    assert.match(fix.fix, /locale and formatting/);
    assert.equal(errors.mismatchFixes.text, fix.fix);
    const shadow = await call('what_fix', { error: 'ERR_HYDRATION_MISMATCH', kind: 'shadow-root' });
    assert.match(shadow.fix, /shadow host/);
  });

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
    assert.ok(write.events.some((l) => / write refresh=99 at main\.jsx:\d+:\d+$/.test(l)), JSON.stringify(write.events));
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
    const count = await pageA.evaluate(() => {
      const state = window.__WHAT_DEVTOOLS__.getState();
      return state.signals.length + state.effects.filter((entry) => entry.async).length;
    });
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
