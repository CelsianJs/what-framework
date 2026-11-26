import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installDOM } from '../../../test-utils/dom.js';
const { window } = installDOM();
const W = await import('what-framework');
const F = await import('what-framework/form');
const S = await import('what-framework/server');
const { useLocalStorage } = await import('what-framework/dom');
const { redirect, Router } = await import('what-framework/router');
const { createRedisStore } = await import('what-isr');
const { captureDiagnostics } = await import('what-framework/testing');
const { createWhatError } = await import('what-core/internal');

const { h, signal, computed, effect } = W;
const catalogue = new Map(JSON.parse(readFileSync(new URL('../../what/diagnostics.json', import.meta.url), 'utf8')).codes
  .map((entry) => [entry.code, entry]));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function triggerComponent(run) {
  const host = document.createElement('div');
  const dispose = W.mount(h(run, {}), host);
  return async () => { await tick(); dispose(); };
}

function delayed() {
  return Promise.resolve(1);
}

function matcher(template) {
  return new RegExp('^' + template.split(/\{\{\w+\}\}/)
    .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]+?') + '$');
}

const browserCases = {
  ASYNC_COMPONENT: () => triggerComponent(async function Slow() { return h('p', {}, 'slow'); })(),
  ASYNC_EFFECT: () => effect(async () => { await 0; })(),
  ASYNC_MEMO: () => triggerComponent(function Example() { const value = W.useMemo(delayed); return h('p', {}, () => String(value())); })(),
  ASYNC_READ_IN_BODY: () => triggerComponent(function Example() { return h('p', {}, computed(delayed)()); })(),
  ASYNC_WITHOUT_SUSPENSE: () => triggerComponent(W.lazy(async () => ({ default: () => h('p', {}, 'lazy') })))(),
  CLEANUP_WITHOUT_OWNER: () => W.onCleanup(() => {}),
  COMPUTED_CYCLE: () => {
    const loop = computed(() => loop() + 1, 'namedLoop');
    assert.throws(loop, { code: 'ERR_COMPUTED_CYCLE', message: /^Computed "namedLoop"/ });
    loop();
  },
  CONTEXT_NOT_PROVIDED: () => triggerComponent(function Example() { W.useContext(W.createContext()); return null; })(),
  DERIVED_WITHOUT_STATE: () => W.createStore({ n: 1, twice: W.derived(() => 2) })(),
  DUPLICATE_KEY: () => triggerComponent(function Example() {
    const items = signal([{ id: 1 }, { id: 1 }]);
    return h('ul', {}, () => items().map((item) => h('li', { key: item.id }, 'item')));
  })(),
  EFFECT_DEP_NOT_FUNCTION: () => triggerComponent(function Example() { W.useEffect(() => {}, [1]); return null; })(),
  FORM_HANDLER_WITHOUT_EVENT: () => triggerComponent(function Example() { F.useForm().register('email').onchange(); return null; })(),
  FORM_RADIO_UNTYPED: () => triggerComponent(function Example() {
    return h('input', { type: 'radio', value: 'x', ...F.useForm().register('item') });
  })(),
  FORM_RADIO_WITHOUT_VALUE: () => triggerComponent(function Example() {
    return h(F.Radio, { name: 'item', register: F.useForm().register });
  })(),
  HOOK_OUTSIDE_COMPONENT: () => W.useState(0),
  INFINITE_EFFECT: () => triggerComponent(function Example() {
    const n = signal(0);
    W.useEffect(function loop() { n(n() + 1); });
    return null;
  })(),
  MISSING_SIGNAL_READ: () => String(signal(0, 'n')),
  NESTED_FLUSH_SYNC: () => effect(() => W.flushSync())(),
  OPTIMISTIC_OUTSIDE_TRANSITION: () => triggerComponent(function Example() {
    const [, add] = W.useOptimistic(signal(1), (a, b) => a + b);
    add(1);
    return null;
  })(),
  REBUILT_COMPONENT: async () => {
    const n = signal(1, 'n');
    function Counter(props) {
      const clicks = signal(0, 'clicks');
      return h('b', {}, () => props.n + ':' + clicks());
    }
    const host = document.createElement('div');
    const dispose = W.mount(h('div', {}, () => h(Counter, { n: n() })), host);
    n(2);
    W.flushSync();
    dispose();
  },
  ORPHAN_EFFECT: async () => {
    let stop;
    await triggerComponent(function Example() {
      W.onMount(async () => { await 0; stop = effect(() => signal(0)()); });
      return null;
    })();
    stop();
  },
  PENDING_READ_UNTRACKED: () => triggerComponent(function Example() {
    return h('p', {}, String(computed(delayed).pending()));
  })(),
  SIGNAL_WRITE_IN_COMPUTED: () => {
    const n = signal(0, 'n');
    const c = computed(() => { n(1); return 1; }, 'writer');
    effect(() => c())();
  },
  STORAGE_FAILED: (t) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else delete globalThis.localStorage;
    });
    t.mock.method(Object.getPrototypeOf(window.localStorage), 'setItem', () => { throw new Error('denied'); });
    return triggerComponent(function Example() { useLocalStorage('key', 1); return null; })();
  },
  USE_UNCACHED_PROMISE: () => triggerComponent(function Example() {
    return h(W.Suspense, { fallback: 'loading' }, h(function Value() {
      return h('p', {}, String(W.use(delayed())));
    }, {}));
  })(),
  WRITE_AFTER_AWAIT: () => {
    const n = signal(0, 'n');
    return W.startTransition(async () => { n(1); await 0; n(2); });
  },
  REDIRECT_NOT_CAUGHT: () => redirect('/next'),
  UNSAFE_REDIRECT: () => redirect('javascript:void(0)'),
  ASYNC_MIDDLEWARE: () => triggerComponent(function Example() {
    return h(Router, { routes: [{ path: '/', component: () => null, middleware: [async () => true] }] });
  })(),
  HYDRATION_MISMATCH: () => {
    const host = document.createElement('div');
    host.innerHTML = '<p>server</p>';
    W.hydrate(h('p', {}, 'client'), host)();
  },
};

const serverCases = {
  FORM_ACTION_MISSING: () => S.renderToString(h(S.Form, {})),
  INVALID_SSR_TAG: () => S.renderToString(h('bad tag<', {})),
  SSR_INVALID_ID_PREFIX: () => S.renderToStream(h('p', {}), { idPrefix: '1bad' }),
  SSR_UNSAFE_REDIRECT: () => S.createResponse().redirect('https://elsewhere.example/'),
  ISR_MISSING_CLIENT: () => createRedisStore({}),
  STATIC_WRITE_ESCAPE: async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'what-diagnostic-'));
    try {
      await S.exportStatic({ outDir: join(tmp, 'out'), routes: [{
        path: '/docs/:slug', mode: 'static', component: () => h('p', {}, 'x'),
        getStaticPaths: () => ({ paths: [{ params: { slug: '../../../x' } }] }),
      }] });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  },
  DUPLICATE_ACTION_ID: () => {
    const originalWindow = globalThis.window;
    try {
      globalThis.window = undefined;
      S.action(() => 1, { id: 'test-duplicate' });
      S.action(() => 2, { id: 'test-duplicate' });
    } finally {
      globalThis.window = originalWindow;
    }
  },
  UNKNOWN: () => { throw createWhatError('NOPE_NOT_A_CODE'); },
};

for (const [name, trigger] of Object.entries({ ...browserCases, ...serverCases })) {
  const code = 'ERR_' + name;
  test(`${code} matches its shipped trigger`, async (t) => {
    const warnings = t.mock.method(console, 'warn', () => {});
    let error;
    const result = await captureDiagnostics(async () => {
      try { await trigger(t); await tick(); } catch (caught) { error = caught; }
    });
    const reported = result.events.find((event) => event.code === code);
    const warning = warnings.mock.calls.find(({ arguments: args }) => args.join(' ').includes(`(${code})`));
    assert.ok(reported || error?.code === code || warning, JSON.stringify({ events: result.events, error: error?.message }));
    const message = reported?.message ?? error?.message ?? (code === 'ERR_DUPLICATE_ACTION_ID' ? warning.arguments[0] : warning.arguments.join(' '));
    assert.match(message, matcher(catalogue.get(code).trigger));
    if (reported) assert.equal(reported.fix, catalogue.get(code).fix);
  });
}
