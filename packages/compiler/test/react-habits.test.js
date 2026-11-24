// Code a React developer writes by habit, on What's own React-named API. Each
// of these compiled, ran, and silently did something else:
//
// - `<Ctx.Provider value={theme()}>`: the provider read `value` once, so the
//   readers stayed on the first value, although every other prop written this
//   way stays live. A provider follows its `value` prop.
// - `<input value={text()} onChange={reject}>`: an edit the handler did not
//   take stayed in the field, which then disagreed with the state. A field
//   whose value or checked is bound to state shows the state again after
//   each of its events. A value that reads no state (a constant, what a
//   spread read once) is where the field starts, as before.
// - `useEffect(fn, [() => src()])`: a function in the deps array that is not
//   a signal passed the development check and was never read, so the effect
//   ran once. It is still not called (deps arrays hold setters and
//   callbacks), and is reported: ERR_EFFECT_DEP_NOT_SIGNAL.
import assert from 'node:assert/strict';
import { after, describe, it, test } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document, window, cleanup } = installDOM();
after(cleanup);

const { h, mount, flushSync, signal, getDiagnostics, clearDiagnostics } = await import('what-framework');
const { __setDevToolsHooks } = await import('what-core/internal');

const alive = new Set();
__setDevToolsHooks({
  onEffectCreate: (e) => alive.add(e),
  onEffectDispose: (e) => alive.delete(e),
});
after(() => __setDevToolsHooks(null));

function mounted(view) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const before = alive.size;
  const stop = mount(view, host);
  flushSync();
  return { host, stop: () => { stop(); host.remove(); }, effects: () => alive.size - before };
}

const mod = await loadCompiled(`
  import { signal, createContext, useContext, useEffect, useMemo, useState } from 'what-framework';
  import { useForm } from 'what-framework/form';

  // --- Provider value ---
  export const theme = signal('light');
  export const user = signal('ada');
  export const seen = [];
  const Theme = createContext('none');
  const Session = createContext(null);
  function Reader() { return <span class="reader">{useContext(Theme)}</span>; }
  function Deep() { return <div><Reader /><Reader /></div>; }
  export function Live() { return <Theme.Provider value={theme()}><Deep /></Theme.Provider>; }
  export function Short() { return <Theme value={theme()}><Reader /></Theme>; }
  export function Constant() { return <Theme.Provider value="fixed"><Reader /></Theme.Provider>; }
  function Calls() { const t = useContext(Theme); return <span class="reader">{t()}</span>; }
  export function Accessor() { return <Theme.Provider value={theme}><Calls /></Theme.Provider>; }
  function Keeps() { return <i class="keeps">{(seen.push(useContext(Session)), useContext(Session).name)}</i>; }
  export function Shared() { return <Session.Provider value={{ name: user() }}><Keeps /><Keeps /></Session.Provider>; }
  export function Nested() {
    return <Theme.Provider value={theme()}><Reader /><Theme.Provider value={user()}><Reader /></Theme.Provider></Theme.Provider>;
  }

  // --- Function deps ---
  export const src = signal(0);
  export const runs = [];
  export let called = 0;
  export function GetterDep() {
    useEffect(() => { runs.push('getter ' + src.peek()); }, [() => { called++; return src(); }]);
    return null;
  }
  export function ComputedDep(props) {
    const doubled = useMemo(() => props.n * 2);
    useEffect(() => { runs.push('computed ' + doubled.peek()); }, [doubled]);
    return null;
  }
  export function CallbackDeps(props) {
    const [count, setCount] = useState(0);
    const load = () => { called++; };
    useEffect(() => { runs.push('callbacks ' + count.peek()); }, [count, setCount, props.onChange, load]);
    return <button onClick={() => setCount((c) => c + 1)}>more</button>;
  }

  // --- Controlled fields ---
  export const text = signal('a');
  export const on = signal(false);
  export const choice = signal('x');
  export const picked = signal('b');
  export const many = signal(['a']);
  export const amount = signal(1);
  export const take = signal(false);
  export const handled = [];
  const edit = (write) => (e) => { handled.push(e.type); if (take()) write(e.target); };
  export function Text() { return <input class="text" value={text()} onInput={edit((el) => text(el.value))} />; }
  export function Area() { return <textarea class="area" value={text()} onInput={edit((el) => text(el.value))} />; }
  export function Check() { return <input class="check" type="checkbox" checked={on()} onChange={edit((el) => on(el.checked))} />; }
  export function Radios() {
    return <form>{['x', 'y', 'z'].map((v) => <input key={v} type="radio" name="choice" value={v} checked={choice() === v} onChange={edit((el) => choice(el.value))} />)}</form>;
  }
  export function Select() {
    return <select class="one" value={picked()} onChange={edit((el) => picked(el.value))}><option>a</option><option>b</option><option>c</option></select>;
  }
  export function Multiple() {
    return <select class="many" multiple value={many()} onChange={edit((el) => many([...el.selectedOptions].map((o) => o.value)))}><option>a</option><option>b</option><option>c</option></select>;
  }
  export function Amount() { return <input class="amount" type="number" value={amount()} onInput={edit((el) => amount(Number(el.value)))} />; }
  export function Stops() { return <input class="stops" value={text()} onInput={(e) => { e.stopPropagation(); }} />; }
  export function NoHandler() { return <input class="locked" value={text()} />; }
  function Field(props) { return <input class="spread" {...props} />; }
  export function Spread() { return <Field value={text()} onInput={edit((el) => text(el.value))} />; }
  // A value that reads no state: a constant, a prop handed a plain value, a
  // plain object's property a spread reads once, and what the forms kit's
  // register() gives.
  export function Starts(props) {
    return <div><input class="constant" value="fixed" /><input class="plain" value={props.initial} /><input class="spread-once" {...{ value: 'once' }} /><input class="constant-check" type="checkbox" checked /></div>;
  }
  export let form = null;
  export function Registered() {
    form = useForm({ defaultValues: { title: 'start', agree: false } });
    return <form><input class="title" {...form.register('title')} /><input class="agree" type="checkbox" {...form.register('agree')} /></form>;
  }
  export function Uncontrolled() {
    return <div><input class="free" defaultValue="start" onInput={() => {}} /><input class="free-check" type="checkbox" defaultChecked onChange={() => {}} /><textarea class="free-area" onInput={() => {}} /></div>;
  }
`);

// Loaded before any test is registered (see branch-memo-trees.test.js).

const text = (host, sel) => [...host.querySelectorAll(sel)].map((n) => n.textContent);
// What a handler's writes caused, and the check a controlled field makes after it.
const settle = async () => {
  await Promise.resolve();
  flushSync();
  await Promise.resolve();
};
const task = () => new Promise((resolve) => setTimeout(resolve, 0));
const fire = (el, type, init) => el.dispatchEvent(new window.Event(type, { bubbles: true, ...init }));

describe('a context provider follows its value prop', () => {
  it('value={theme()} reaches every reader, now and after each write', () => {
    mod.theme('light');
    for (const View of [mod.Live, mod.Short]) {
      const { host, stop, effects } = mounted(h(View, {}));
      assert.ok(text(host, '.reader').every((t) => t === 'light'));
      const steady = effects();
      mod.theme('dark');
      flushSync();
      assert.ok(text(host, '.reader').every((t) => t === 'dark'), 'the readers follow the signal the value read');
      assert.equal(effects(), steady);
      mod.theme('light');
      flushSync();
      stop();
      assert.equal(effects(), 0, 'nothing is left of the provider');
    }
  });

  it('a value that cannot change costs no effect, and a signal handed over as it is stays an accessor', () => {
    const constant = mounted(h(mod.Constant, {}));
    assert.deepEqual(text(constant.host, '.reader'), ['fixed']);
    assert.equal(constant.effects(), 1, 'the reader\'s text only');
    constant.stop();

    mod.theme('light');
    const accessor = mounted(h(mod.Accessor, {}));
    assert.deepEqual(text(accessor.host, '.reader'), ['light']);
    mod.theme('dark');
    flushSync();
    assert.deepEqual(text(accessor.host, '.reader'), ['dark']);
    mod.theme('light');
    accessor.stop();
  });

  it('an object written in the value is one object for every reader until what it read changes', () => {
    mod.user('ada');
    mod.seen.length = 0;
    const { host, stop } = mounted(h(mod.Shared, {}));
    assert.deepEqual(text(host, '.keeps'), ['ada', 'ada']);
    assert.equal(mod.seen.length, 2);
    assert.equal(mod.seen[0], mod.seen[1], 'both readers were handed the same object');
    mod.user('grace');
    flushSync();
    assert.deepEqual(text(host, '.keeps'), ['grace', 'grace']);
    assert.notEqual(mod.seen.at(-1), mod.seen[0], 'a new object once the user changed');
    assert.equal(mod.seen.at(-1), mod.seen.at(-2));
    stop();
  });

  it('a provider inside another follows its own value', () => {
    mod.theme('light');
    mod.user('ada');
    const { host, stop } = mounted(h(mod.Nested, {}));
    assert.deepEqual(text(host, '.reader'), ['light', 'ada']);
    mod.theme('dark');
    flushSync();
    assert.deepEqual(text(host, '.reader'), ['dark', 'ada']);
    mod.user('grace');
    flushSync();
    assert.deepEqual(text(host, '.reader'), ['dark', 'grace']);
    mod.theme('light');
    stop();
  });
});

describe('a function in a useEffect dependency array that is not a signal', () => {
  const codes = () => getDiagnostics().events.filter((e) => e.code.startsWith('ERR_EFFECT_DEP')).map((e) => e.code);

  it('is reported when it takes no argument, and never called', async () => {
    clearDiagnostics();
    mod.runs.length = 0;
    mod.src(0);
    const called = mod.called;
    const { stop } = mounted(h(mod.GetterDep, {}));
    await settle();
    mod.src(1);
    await settle();
    assert.deepEqual(mod.runs, ['getter 0'], 'the effect ran once: nothing tracks the arrow');
    assert.equal(mod.called, called, 'and the arrow was not called');
    assert.deepEqual(codes(), ['ERR_EFFECT_DEP_NOT_SIGNAL']);
    assert.match(getDiagnostics().events.find((e) => e.code === 'ERR_EFFECT_DEP_NOT_SIGNAL').message, /dependency 0 is a function/);
    stop();
  });

  it('a computed over the same expression is a signal, and re-runs the effect', async () => {
    clearDiagnostics();
    mod.runs.length = 0;
    const n = signal(1);
    const { stop } = mounted(h(() => mod.ComputedDep({ get n() { return n(); } }), {}));
    await settle();
    n(2);
    await settle();
    assert.deepEqual(mod.runs, ['computed 2', 'computed 4']);
    assert.deepEqual(codes(), []);
    stop();
  });

  it('a setter and a handler are not reported, and no callback is called for the effect', async () => {
    clearDiagnostics();
    mod.runs.length = 0;
    const called = mod.called;
    let changes = 0;
    const { host, stop } = mounted(h(mod.CallbackDeps, { onChange: (e) => { changes++; return e; } }));
    await settle();
    host.querySelector('button').dispatchEvent(new window.Event('click', { bubbles: true }));
    await settle();
    assert.deepEqual(mod.runs, ['callbacks 0', 'callbacks 1'], 'the signal in the array re-ran it');
    assert.equal(mod.called, called, 'the callback with no parameter was not called');
    assert.equal(changes, 0, 'nor the handler');
    assert.equal(host.querySelector('button').isConnected, true);
    // Only the function that takes no argument could have been meant as a getter.
    assert.deepEqual(codes(), ['ERR_EFFECT_DEP_NOT_SIGNAL']);
    assert.match(getDiagnostics().events.find((e) => e.code === 'ERR_EFFECT_DEP_NOT_SIGNAL').message, /dependency 3 is a function/);
    stop();
  });
});

describe('a field a prop controls shows what the prop holds after each of its events', () => {
  const reset = () => {
    mod.take(false);
    mod.text('a');
    mod.on(false);
    mod.choice('x');
    mod.picked('b');
    mod.many(['a']);
    mod.amount(1);
    mod.handled.length = 0;
    flushSync();
  };

  for (const [name, view, sel] of [['a text input', 'Text', '.text'], ['a textarea', 'Area', '.area']]) {
    it(`${name}: an edit the handler did not take is undone, one it took stands with its caret`, async () => {
      reset();
      const { host, stop } = mounted(h(mod[view], {}));
      const field = host.querySelector(sel);
      field.value = 'ab';
      fire(field, 'input');
      assert.equal(field.value, 'ab', 'the handlers see the edit');
      await settle();
      assert.deepEqual(mod.handled, ['input']);
      assert.equal(field.value, 'a', 'the field shows the state again');
      assert.equal(mod.text(), 'a');

      mod.take(true);
      field.value = 'xab';
      field.setSelectionRange(1, 1);
      fire(field, 'input');
      await settle();
      assert.equal(mod.text(), 'xab');
      assert.equal(field.value, 'xab');
      assert.equal(field.selectionStart, 1, 'nothing was written to a field that already shows the value');
      stop();
    });
  }

  it('a checkbox goes back to what its prop holds', async () => {
    reset();
    const { host, stop } = mounted(h(mod.Check, {}));
    const box = host.querySelector('.check');
    box.checked = true;
    fire(box, 'change');
    await settle();
    assert.equal(box.checked, false);
    mod.take(true);
    box.checked = true;
    fire(box, 'change');
    await settle();
    assert.equal(mod.on(), true);
    assert.equal(box.checked, true);
    stop();
  });

  it('a radio group goes back as a whole', async () => {
    reset();
    const { host, stop } = mounted(h(mod.Radios, {}));
    const [x, y, z] = host.querySelectorAll('input');
    assert.deepEqual([x.checked, y.checked, z.checked], [true, false, false]);
    y.checked = true;
    fire(y, 'change');
    assert.deepEqual([x.checked, y.checked, z.checked], [false, true, false], 'the browser unchecked the one the state names');
    await settle();
    assert.deepEqual([x.checked, y.checked, z.checked], [true, false, false]);
    mod.take(true);
    z.checked = true;
    fire(z, 'change');
    await settle();
    assert.equal(mod.choice(), 'z');
    assert.deepEqual([x.checked, y.checked, z.checked], [false, false, true]);
    stop();
  });

  it('a select, single and multiple, selects what its value names again', async () => {
    reset();
    const one = mounted(h(mod.Select, {}));
    const select = one.host.querySelector('.one');
    assert.equal(select.value, 'b');
    select.value = 'c';
    fire(select, 'change');
    await settle();
    assert.equal(select.value, 'b');
    mod.take(true);
    select.value = 'c';
    fire(select, 'change');
    await settle();
    assert.equal(mod.picked(), 'c');
    assert.equal(select.value, 'c');
    one.stop();

    reset();
    const many = mounted(h(mod.Multiple, {}));
    const multiple = many.host.querySelector('.many');
    const marks = () => [...multiple.options].map((o) => o.selected);
    assert.deepEqual(marks(), [true, false, false]);
    multiple.options[0].selected = false;
    multiple.options[2].selected = true;
    fire(multiple, 'change');
    await settle();
    assert.deepEqual(marks(), [true, false, false]);
    mod.take(true);
    multiple.options[1].selected = true;
    fire(multiple, 'change');
    await settle();
    assert.deepEqual(mod.many(), ['a', 'b']);
    assert.deepEqual(marks(), [true, true, false]);
    many.stop();
  });

  it('a number field is compared as a number, and left alone while it holds bad input', async () => {
    reset();
    const { host, stop } = mounted(h(mod.Amount, {}));
    const field = host.querySelector('.amount');
    mod.take(true);
    field.value = '1.0';
    fire(field, 'input');
    await settle();
    assert.equal(mod.amount(), 1);
    assert.equal(field.value, '1.0', 'the same number, as the user wrote it');
    // "1." on the way to "1.5": the field reports bad input and an empty value.
    Object.defineProperty(field, 'validity', { configurable: true, value: { badInput: true } });
    mod.take(false);
    field.value = '';
    fire(field, 'input');
    await settle();
    assert.equal(field.value, '');
    delete field.validity;
    field.value = '7';
    fire(field, 'input');
    await settle();
    assert.equal(field.value, '1', 'another number the handler did not take is undone');
    stop();
  });

  it('the field is left alone while an input method composes, and checked when it is done', async () => {
    reset();
    const { host, stop } = mounted(h(mod.Text, {}));
    const field = host.querySelector('.text');
    field.value = 'aに';
    field.dispatchEvent(new window.InputEvent('input', { bubbles: true, isComposing: true }));
    await settle();
    await task();
    assert.equal(field.value, 'aに', 'the composition is not interrupted');
    field.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true, data: 'に' }));
    await settle();
    assert.equal(field.value, 'a', 'the handler never took the text');
    stop();
  });

  it('a handler that stops the event does not keep the field from being checked', async () => {
    reset();
    const { host, stop } = mounted(h(mod.Stops, {}));
    const field = host.querySelector('.stops');
    field.value = 'ab';
    fire(field, 'input');
    await settle();
    await task();
    assert.equal(field.value, 'a');
    stop();
  });

  it('a value with no handler is a field the user cannot change, as in React', async () => {
    reset();
    const { host, stop } = mounted(h(mod.NoHandler, {}));
    const field = host.querySelector('.locked');
    field.value = 'ab';
    fire(field, 'input');
    await settle();
    assert.equal(field.value, 'a');
    mod.text('b');
    flushSync();
    assert.equal(field.value, 'b');
    stop();
  });

  it('a value that reads no state is where the field starts: the edit stands', async () => {
    const { host, stop } = mounted(h(mod.Starts, { initial: 'given' }));
    const fields = ['.constant', '.plain', '.spread-once'].map((sel) => host.querySelector(sel));
    assert.deepEqual(fields.map((f) => f.value), ['fixed', 'given', 'once']);
    for (const field of fields) {
      field.value = 'typed';
      fire(field, 'input');
    }
    const check = host.querySelector('.constant-check');
    check.checked = false;
    fire(check, 'change');
    await settle();
    await task();
    assert.deepEqual(fields.map((f) => f.value), ['typed', 'typed', 'typed']);
    assert.equal(check.checked, false);
    stop();
  });

  it('a field the forms kit registers through a spread keeps what the user types, and the form gets it', async () => {
    const { host, stop } = mounted(h(mod.Registered, {}));
    const title = host.querySelector('.title');
    const agree = host.querySelector('.agree');
    assert.equal(title.value, 'start');
    title.value = 'typed';
    fire(title, 'input');
    agree.checked = true;
    fire(agree, 'change');
    fire(agree, 'input');
    await settle();
    await task();
    assert.equal(title.value, 'typed', 'the registered field is the user\'s');
    assert.equal(agree.checked, true);
    assert.equal(mod.form.getValue('title'), 'typed');
    stop();
  });

  it('a field no prop controls is left as the user left it', async () => {
    reset();
    const { host, stop } = mounted(h(mod.Uncontrolled, {}));
    const free = host.querySelector('.free');
    const check = host.querySelector('.free-check');
    const area = host.querySelector('.free-area');
    free.value = 'typed';
    fire(free, 'input');
    check.checked = false;
    fire(check, 'change');
    area.value = 'typed';
    fire(area, 'input');
    await settle();
    await task();
    assert.equal(free.value, 'typed');
    assert.equal(check.checked, false);
    assert.equal(area.value, 'typed');
    stop();
  });

  it('a field whose value a spread sets is checked the same way', async () => {
    reset();
    const { host, stop } = mounted(h(mod.Spread, {}));
    const field = host.querySelector('.spread');
    field.value = 'ab';
    fire(field, 'input');
    await settle();
    assert.equal(field.value, 'a');
    mod.take(true);
    field.value = 'ab';
    fire(field, 'input');
    await settle();
    assert.equal(mod.text(), 'ab');
    assert.equal(field.value, 'ab');
    stop();
  });

  it('a field made with h() keeps the edit until its prop writes again, whatever else the page holds', async () => {
    reset();
    const compiled = mounted(h(mod.NoHandler, {}));
    const value = signal('a');
    const { host, stop } = mounted(h('input', { class: 'made', value: () => value(), onInput: () => {} }));
    const field = host.querySelector('.made');
    field.value = 'ab';
    fire(field, 'input');
    await settle();
    await task();
    assert.equal(field.value, 'ab', 'h() fields are not put back');
    value('b');
    flushSync();
    assert.equal(field.value, 'b');
    stop();
    compiled.stop();
  });

  it('the compiler marks a spread on a field, and the bindings of a field\'s value and checked', () => {
    const out = compileJSX('const A = (p) => <form><input {...p.a} /><textarea {...p.b} /><select {...p.c} /><div {...p.d} /><option {...p.e} /></form>;');
    assert.equal(out.match(/_\$spread\(_\$controlled\(/g).length, 3);
    assert.equal(out.match(/_\$spread\(_el\$\d+, /g).length, 2);

    const bound = compileJSX('const A = (p) => <form><input value={p.text()} /><input type="checkbox" checked={p.on()} /><textarea value={p.text()} /><select value={p.pick()}><option value={p.first()}>a</option></select><input value="fixed" /><input value={p.name} /></form>;');
    const call = (text) => bound.split('\n').find((line) => line.includes(text));
    // A binding (an expression in its own effect) says so; a value written once does not.
    assert.match(call('p.text(), 1'), /_\$effect\(\(\) => _\$setValue\(_el\$\d+, p\.text\(\), 1\)\)/);
    assert.match(call('p.on()'), /_\$setChecked\(_el\$\d+, p\.on\(\), 1\)/);
    assert.match(call('p.pick()'), /_\$setValue\(_el\$\d+, p\.pick\(\), 1\)/);
    assert.match(call('p.name'), /_\$setValue\(_el\$\d+, p\.name, 1\)/);
    assert.match(call('"fixed"'), /_\$setValue\(_el\$\d+, "fixed"\);/);
    assert.doesNotMatch(call('p.first()'), /, 1\)/, 'an option\'s value names it: it is no field');
  });
});

test('no listener is added to a field a prop controls: its window hears the events', () => {
  const field = document.createElement('input');
  let added = 0;
  field.addEventListener = () => { added++; };
  const stop = mount(h('div', {}, field), document.body.appendChild(document.createElement('div')));
  const controlled = mounted(h(mod.NoHandler, {}));
  assert.equal(added, 0);
  controlled.stop();
  stop();
});
