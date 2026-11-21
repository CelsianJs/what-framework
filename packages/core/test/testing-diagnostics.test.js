// Tests for the diagnostics capture and assertions in what-framework/testing.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const reactive = await import('../src/reactive.js');
const { signal, effect, createRoot, flushSync, __setDevToolsHooks } = reactive;
const { h } = await import('../src/h.js');
const { useForm } = await import('../src/form.js');
const {
  captureDiagnostics,
  expectNoDiagnostics,
  expectDiagnostic,
  expectRuns,
  render,
  cleanup,
  fireEvent,
} = await import('../src/testing.js');

afterEach(() => cleanup());

function silenceConsole(run) {
  const original = { warn: console.warn, error: console.error };
  const printed = [];
  console.warn = (...a) => printed.push(a.join(' '));
  console.error = (...a) => printed.push(a.join(' '));
  try { return { value: run(), printed }; } finally {
    console.warn = original.warn;
    console.error = original.error;
  }
}

describe('captureDiagnostics', () => {
  it('returns the reports made inside the callback, off the console, plus its return value', () => {
    const count = signal(3, 'count');
    const { value: cap, printed } = silenceConsole(() => captureDiagnostics(() => `Total: ${count}`));
    assert.equal(printed.length, 0, 'reports stay off the console while capturing');
    assert.equal(cap.events.length, 1);
    assert.equal(cap.events[0].code, 'ERR_MISSING_SIGNAL_READ');
    assert.ok(cap.result.startsWith('Total: function'), 'the callback result is returned as-is');
  });

  it('counts effect runs by name', () => {
    const n = signal(0);
    let dispose;
    const cap = captureDiagnostics(() => {
      createRoot((d) => {
        dispose = d;
        effect(function syncTitle() { n(); });
      });
      n(1);
      flushSync();
      n(2);
      flushSync();
    });
    dispose();
    assert.equal(cap.runs.syncTitle, 3);
  });

  it('awaits an async callback', async () => {
    const cap = await captureDiagnostics(async () => {
      await Promise.resolve();
      useForm({ defaultValues: { nick: 'a' } }).register('nick').oninput();
      return 'done';
    });
    assert.equal(cap.result, 'done');
    expectDiagnostic(cap, { code: 'ERR_FORM_HANDLER_WITHOUT_EVENT' });
  });

  it('overlapping async captures each count the runs made while they are open', async () => {
    const gateA = Promise.withResolvers();
    const gateB = Promise.withResolvers();
    const before = reactive.__devtools;
    const s = signal(0);
    let dispose;
    createRoot((d) => {
      dispose = d;
      effect(function measured() { s(); });
    });
    try {
      const a = captureDiagnostics(async () => { await gateA.promise; });
      const b = captureDiagnostics(async () => {
        await gateB.promise;
        s(1);
        await Promise.resolve();
      });
      gateA.resolve();
      const outer = await a;
      gateB.resolve();
      const inner = await b;
      assert.deepEqual(outer.runs, {}, 'nothing ran while only the first capture was open');
      assert.equal(inner.runs.measured, 1, 'the capture still open after the other finished saw the run');
      assert.equal(reactive.__devtools, before, 'the original hooks are back once both captures ended');
    } finally {
      dispose();
    }
  });

  it('chains installed devtools hooks and restores them, even when the callback throws', () => {
    const seen = [];
    const hooks = { onEffectRun: () => seen.push('run') };
    __setDevToolsHooks(hooks);
    try {
      assert.throws(() => captureDiagnostics(() => {
        createRoot((d) => { effect(() => {}); d(); });
        throw new Error('boom');
      }), /boom/);
      assert.equal(reactive.__devtools, hooks, 'previous hooks are back in place');
      assert.ok(seen.length >= 1, 'the previous hook still received the run');
    } finally {
      __setDevToolsHooks(null);
    }
  });

  it('the ERR_FORM_HANDLER_WITHOUT_EVENT worked example runs as written', async () => {
    const { ERROR_CODES } = await import('../src/errors.js');
    const example = ERROR_CODES.FORM_HANDLER_WITHOUT_EVENT.codeExample;
    const [, handler] = example.match(/field\.(\w+)\('a@b\.co'\)/);
    const form = useForm();
    const field = form.register('email');
    assert.equal(typeof field[handler], 'function', `register() on a text field returns no ${handler}`);
    expectDiagnostic(captureDiagnostics(() => field[handler]('a@b.co')), { code: 'ERR_FORM_HANDLER_WITHOUT_EVENT' });
    assert.ok(example.includes("form.setValue('email', 'a@b.co')"));
    form.setValue('email', 'a@b.co');
    assert.equal(form.getValue('email'), 'a@b.co');
  });

  it('tests a form interaction by visible state, diagnostics and effect budget together', () => {
    let form;
    function Signup() {
      form = useForm({ defaultValues: { email: '' } });
      const shown = signal('');
      effect(function mirrorEmail() { shown(form.watch('email')); });
      return h('form', null,
        h('input', { 'data-testid': 'email', ...form.register('email') }),
        h('output', { 'data-testid': 'out' }, () => shown()),
      );
    }

    const view = render(h(Signup));
    const cap = captureDiagnostics(() => {
      fireEvent.change(view.getByTestId('email'), 'a@b.co');
      flushSync();
    });

    assert.equal(view.getByTestId('out').textContent, 'a@b.co');
    expectNoDiagnostics(cap);
    expectRuns(cap, { effect: 'mirrorEmail', max: 1 });
  });
});

describe('assertions', () => {
  const event = {
    seq: 1, code: 'ERR_CONTEXT_NOT_PROVIDED', severity: 'warning', message: 'Theme was read with no provider above the component and has no default value, so useContext returned undefined.',
    fix: 'Render the reader inside <Theme value>.', owner: ['<App>', '<Cart>'], loc: 'src/Cart.jsx:4:9', subject: null, data: {}, count: 2,
  };

  it('expectNoDiagnostics lists code, count, owner, location and fix when it fails', () => {
    assert.throws(() => expectNoDiagnostics({ events: [event] }), (err) => {
      assert.match(err.message, /Expected no diagnostics, got 1/);
      assert.match(err.message, /ERR_CONTEXT_NOT_PROVIDED ×2 Theme was read with no provider/);
      assert.match(err.message, /in <App> › <Cart>/);
      assert.match(err.message, /at src\/Cart\.jsx:4:9/);
      assert.match(err.message, /fix: Render the reader inside <Theme value>\./);
      return true;
    });
    assert.doesNotThrow(() => expectNoDiagnostics({ events: [event] }, { allow: ['ERR_CONTEXT_NOT_PROVIDED'] }));
    assert.doesNotThrow(() => expectNoDiagnostics({ events: [] }));
  });

  it('expectDiagnostic requires that code and nothing else', () => {
    assert.doesNotThrow(() => expectDiagnostic({ events: [event] }, { code: 'ERR_CONTEXT_NOT_PROVIDED' }));
    assert.throws(() => expectDiagnostic({ events: [] }, { code: 'ERR_CONTEXT_NOT_PROVIDED' }), /got none/);
    assert.throws(
      () => expectDiagnostic({ events: [event, { ...event, code: 'ERR_STORAGE_FAILED' }] }, { code: 'ERR_CONTEXT_NOT_PROVIDED' }),
      /Expected exactly ERR_CONTEXT_NOT_PROVIDED, got:[\s\S]*ERR_STORAGE_FAILED/,
    );
  });

  it('expectRuns names the effect, the budget and every run when it fails', () => {
    const cap = {
      effects: [
        { name: 'syncTitle', kind: 'effect', owner: ['<App>'], runs: 4 },
        { name: '(anonymous)', kind: 'effect', owner: ['<App>', '<Row>'], runs: 9 },
        { name: 'neverRan', kind: 'effect', owner: ['<App>'], runs: 0 },
      ],
    };
    assert.doesNotThrow(() => expectRuns(cap, { effect: 'syncTitle', max: 4 }));
    assert.doesNotThrow(() => expectRuns(cap, { effect: 'neverRan', max: 0 }));
    assert.throws(() => expectRuns(cap, { effect: 'syncTitle', max: 2 }), (err) => {
      assert.match(err.message, /Expected effect "syncTitle" to run at most 2 time\(s\), it ran 4/);
      assert.match(err.message, /\(anonymous\): 9/);
      return true;
    });
  });
});
