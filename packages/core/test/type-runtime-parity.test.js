// Declaration-versus-runtime parity for packages/core/index.d.ts.
//
// hygiene:types already checks that every declared NAME exists in the runtime,
// and api-types.test.js checks that the declarations compile. Neither looks at
// the SHAPE behind a name, which is how these shipped:
//
//   useMemo declared `: T`            -> runtime returns a computed accessor
//   useReducer declared `[S, ...]`    -> runtime returns [Signal<S>, ...]
//   useRovingTabIndex                 -> rewritten (options, focusItem,
//                                        overrides) with the old signature left
//                                        in place
//   tween declared as spring's shape  -> a completely different object, and a
//                                        (from, to) signature declared as (v?)
//   useTransition / useAnimatedValue  -> four and two members that have never
//   spring().reset / register().onInput  existed at all
//
// Every phantom above type-checked, so an editor autocompleted it and the call
// threw at runtime. The declaration was worse than no declaration.
//
// So each case is pinned TWICE, and the two halves have to agree:
//
//   1. RUNTIME: call the thing and assert the object it really returns, so a
//      rewrite like this week's useRovingTabIndex fails here instead of quietly
//      invalidating the .d.ts.
//   2. TYPES:   typecheck real usage against the shipped declarations, in
//      BOTH directions. The positive file must compile and each negative file
//      must NOT: a name-only or positive-only type test is exactly what let a
//      declaration widened to `any` (or left at the pre-rewrite shape) through.
//
// The type half runs one in-memory program over virtual files, so it costs one
// typecheck for the whole table rather than one per case.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'https://example.test/',
});
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.localStorage = dom.window.localStorage;
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
// useFetch fires on creation; this keeps the assertion about its INITIAL value
// from depending on the network.
global.fetch = async () => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => ({}),
});

const W = await import('../src/index.js');
const { h, mount, flushSync } = W;

// --- Runtime harness -------------------------------------------------------
// Most of these are component-scoped hooks (getCurrentComponent must be set),
// so they have to run inside a real mount rather than at module scope.

const mounted = [];

function inComponent(fn) {
  let captured;
  let thrown;
  function Probe() {
    try {
      captured = fn();
    } catch (e) {
      thrown = e;
    }
    return h('div', {}, '');
  }
  mounted.push(mount(h(Probe, {}), '#app'));
  if (thrown) throw thrown;
  return captured;
}

after(() => {
  for (const unmount of mounted) {
    try { unmount(); } catch { /* already gone */ }
  }
});

/** Sorted own-key list: the assertion that catches BOTH a phantom and a missing member. */
const keys = (o) => Object.keys(o).sort();

// --- Type harness ----------------------------------------------------------

const require = createRequire(import.meta.url);
const ts = require('typescript');
const HERE = dirname(fileURLToPath(import.meta.url));

const TS_OPTIONS = {
  strict: true,
  noEmit: true,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  types: [],
  // The declarations' own internal correctness is `npm run typecheck`'s job
  // (tsconfig.json, skipLibCheck:false). Here they only need to RESOLVE, and
  // skipping the lib pass keeps this test at ~200ms instead of seconds.
  skipLibCheck: true,
};

// Files are placed inside packages/core/test so `what-framework` resolves the
// way it does for a real consumer: node_modules/what-framework -> packages/what
// -> `export * from 'what-core'` -> the file under test.
function typecheck(files) {
  const virtual = new Map(Object.entries(files).map(([name, src]) => [join(HERE, name), src]));
  const host = ts.createCompilerHost(TS_OPTIONS, true);
  const realGetSourceFile = host.getSourceFile.bind(host);
  const realFileExists = host.fileExists.bind(host);
  const realReadFile = host.readFile.bind(host);
  host.getSourceFile = (name, lang, ...rest) => (
    virtual.has(name)
      ? ts.createSourceFile(name, virtual.get(name), lang, true)
      : realGetSourceFile(name, lang, ...rest)
  );
  host.fileExists = (name) => (virtual.has(name) ? true : realFileExists(name));
  host.readFile = (name) => (virtual.has(name) ? virtual.get(name) : realReadFile(name));

  const program = ts.createProgram([...virtual.keys()], TS_OPTIONS, host);
  const byFile = new Map([...virtual.keys()].map((f) => [f, []]));
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const bucket = d.file && byFile.get(d.file.fileName);
    const text = `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
    if (bucket) bucket.push(text);
    else throw new Error(`diagnostic outside the fixtures: ${text}`);
  }
  return new Map([...byFile].map(([f, diags]) => [f.split('/').pop(), diags]));
}

// Correct usage of every signature this file pins. One error here means a
// declaration drifted back below the runtime.
const POSITIVE = `
import {
  useMemo, useReducer, useRovingTabIndex, spring, tween, useTransition,
  useAnimatedValue, useGesture, createTransitionClasses, cssTransition,
  useForm, useQuery, useInfiniteQuery, useFetch, invalidateQueries,
  getQueryData, createStore, derived, h,
} from 'what-framework';

// useMemo hands back an accessor, so it is called to read.
const total = useMemo(() => 1 + 1);
export const totalValue: number = total();

// useReducer's first element is the signal, so it is called to read.
const [count, dispatch] = useReducer((s: number, a: 'inc') => (a === 'inc' ? s + 1 : s), 0);
export const countValue: number = count();
dispatch('inc');

// Roving tabindex: caller-supplied role, focusItem, and per-call overrides.
const roving = useRovingTabIndex(() => 3, { role: 'menu' });
export const focused: Element | null = roving.focusItem(0);
export const tabbable: number = roving.getItemProps(0, { class: 'item' }).tabIndex();
export const container: Record<string, any> = roving.containerProps({ id: 'menu' });
export const item = h('li', roving.getItemProps(1));

// Spring and tween are different objects with different signatures.
const s = spring(0, { stiffness: 120 });
s.set(10); s.snap(0); s.stop();
export const springReads: number[] = [s.current(), s.target(), s.velocity()];
const t = tween(0, 100, { duration: 300 });
export const tweenReads: number[] = [t.progress(), t.value()];
t.cancel();

// useTransition drives progress; useAnimatedValue returns per-animation handles.
const transition = useTransition({ duration: 200 });
export const transitionStart: Promise<void> = transition.start(() => {});
export const transitioning: boolean = transition.isTransitioning();
const animated = useAnimatedValue(0);
animated.setValue(1);
animated.spring(10).stop();
animated.timing(10, { duration: 100 }).stop();
export const interpolated: number = animated.interpolate([0, 1], [0, 100])();

// useGesture returns its state, and preventDefault is a boolean beside the callbacks.
const gesture = useGesture(document.createElement('div'), {
  onSwipe: ({ direction }) => direction,
  preventDefault: true,
});
export const dragging: boolean = gesture.isDragging();

export const classes: string = createTransitionClasses('fade').enterActive;
export const applied: Promise<void> = cssTransition(document.createElement('div'), 'fade', 'exit', 200);

// Forms: lowercase handler keys, and isValidating.
const form = useForm({ defaultValues: { email: '' } });
const registration = form.register('email');
registration.oninput?.({});
export const validating: boolean = form.formState.isValidating();
export const input = h('input', registration);

// Queries.
const query = useQuery<{ id: string }>({ queryKey: ['user'], queryFn: async () => ({ id: 'a' }) });
export const idle: boolean = query.isIdle();
export const fetchState: string = query.fetchStatus();
const infinite = useInfiniteQuery<{ id: string }[]>({ queryKey: ['feed'], queryFn: async () => [] });
export const firstPage = infinite.data().pages[0];
export const morePages: boolean = infinite.hasPreviousPage();
export const fetched = useFetch<{ id: string }>('/api').data();
invalidateQueries(['todos'], { hard: true });
export const cached = getQueryData<{ id: string }>(['todos', 1]);

// A derived store field reads as its VALUE.
const useCounter = createStore({ n: 1, doubled: derived((state: any) => state.n * 2), inc() {} });
export const doubled: number = useCounter().doubled;
`;

// Each of these is a shape the declarations USED to promise. Every one must be
// rejected now; if any compiles, the old lie is back (or the type went `any`).
const NEGATIVE = {
  'neg-usememo.ts': `
    import { useMemo } from 'what-framework';
    export const bad: number = useMemo(() => 1) * 2;
  `,
  'neg-usereducer.ts': `
    import { useReducer } from 'what-framework';
    const [state] = useReducer((s: { n: number }) => s, { n: 0 });
    export const bad: number = state.n;
  `,
  // focusItem/options/overrides not existing is pinned by POSITIVE compiling.
  // This pins the other half: that they were not declared as `any`.
  'neg-roving-focusitem.ts': `
    import { useRovingTabIndex } from 'what-framework';
    export const bad: string = useRovingTabIndex(3).focusItem(0);
  `,
  'neg-spring-reset.ts': `
    import { spring } from 'what-framework';
    export const bad = spring(0).reset();
  `,
  'neg-tween-current.ts': `
    import { tween } from 'what-framework';
    export const bad = tween(0).current();
  `,
  'neg-usetransition.ts': `
    import { useTransition } from 'what-framework';
    export const bad = useTransition().mounted;
  `,
  'neg-useanimatedvalue.ts': `
    import { useAnimatedValue } from 'what-framework';
    export const bad = useAnimatedValue(0).animateTo(1);
  `,
  'neg-transition-classes.ts': `
    import { createTransitionClasses } from 'what-framework';
    export const bad: string = createTransitionClasses('fade');
  `,
  'neg-register-oninput.ts': `
    import { useForm } from 'what-framework';
    export const bad = useForm().register('email').onInput;
  `,
  'neg-infinite-data.ts': `
    import { useInfiniteQuery } from 'what-framework';
    export const bad = useInfiniteQuery<{ id: string }>({}).data().map((p) => p);
  `,
  'neg-invalidate-await.ts': `
    import { invalidateQueries } from 'what-framework';
    export const bad: Promise<void> = invalidateQueries('todos');
  `,
  // Called WITH the state argument the old DerivedFn signature wanted, so this
  // fails on "not callable" rather than on arity, i.e. it really is testing
  // that the derived field resolved to a value.
  'neg-store-derived.ts': `
    import { createStore, derived } from 'what-framework';
    const useCounter = createStore({ n: 1, doubled: derived((s: any) => s.n * 2) });
    export const bad = useCounter().doubled({ n: 1 });
  `,
};

// =========================================================================
// 1. Runtime shapes
// =========================================================================

describe('runtime shape: hooks', () => {
  it('useMemo returns a computed accessor, not the value', () => {
    const memo = inComponent(() => W.useMemo(() => 21 * 2, []));
    assert.equal(typeof memo, 'function');
    assert.equal(memo._signal, true, 'useMemo must return a signal-like accessor');
    assert.equal(memo(), 42);
  });

  it('useReducer returns [signal, dispatch], not [state, dispatch]', () => {
    const [state, dispatch] = inComponent(
      () => W.useReducer((s, a) => (a === 'inc' ? s + 1 : s), 5),
    );
    assert.equal(typeof state, 'function');
    assert.equal(state._signal, true);
    assert.equal(state(), 5);
    assert.equal(typeof dispatch, 'function');
    dispatch('inc');
    flushSync();
    assert.equal(state(), 6, 'dispatch must move the signal the hook handed back');
  });
});

describe('runtime shape: useRovingTabIndex', () => {
  it('exposes focusIndex, setFocusIndex, focusItem, getItemProps, containerProps', () => {
    const roving = inComponent(() => W.useRovingTabIndex(3));
    assert.deepEqual(
      keys(roving),
      ['containerProps', 'focusIndex', 'focusItem', 'getItemProps', 'setFocusIndex'],
    );
  });

  it('emits no container role by default and the caller-supplied one when asked', () => {
    const bare = inComponent(() => W.useRovingTabIndex(3));
    assert.deepEqual(bare.containerProps(), {});
    const menu = inComponent(() => W.useRovingTabIndex(3, { role: 'menu' }));
    assert.deepEqual(menu.containerProps(), { role: 'menu' });
    assert.deepEqual(menu.containerProps({ id: 'm' }), { role: 'menu', id: 'm' });
  });

  it('getItemProps takes overrides and returns a ref plus a tabIndex ACCESSOR', () => {
    const roving = inComponent(() => W.useRovingTabIndex(2));
    const props = roving.getItemProps(0, { class: 'item' });
    assert.deepEqual(keys(props), ['class', 'onFocus', 'onKeyDown', 'ref', 'tabIndex']);
    assert.equal(props.class, 'item', 'overrides must be merged in');
    assert.equal(typeof props.tabIndex, 'function', 'tabIndex must stay reactive through a spread');
    assert.equal(props.tabIndex(), 0);
    assert.equal(roving.getItemProps(1).tabIndex(), -1);
  });

  it('focusItem moves real focus and returns the element, or null when out of range', () => {
    // The hook treats a detached node as missing (focus() on one is a silent
    // no-op), so the items have to live somewhere mount() does not empty.
    // #app is the mount container and gets cleared.
    const roving = inComponent(() => W.useRovingTabIndex(3));
    const items = [0, 1, 2].map(() => {
      const el = document.createElement('button');
      document.body.appendChild(el);
      return el;
    });
    items.forEach((el, i) => { roving.getItemProps(i).ref.current = el; });

    assert.equal(roving.focusItem(1), items[1]);
    assert.equal(document.activeElement, items[1]);
    assert.equal(roving.focusIndex(), 1);
    assert.equal(roving.focusItem(99), null, 'an out-of-range index is refused, not clamped');
    assert.equal(roving.focusIndex(), 1, 'and it must not move the index either');

    for (const el of items) el.remove();
  });
});

describe('runtime shape: animation', () => {
  it('spring exposes set/stop/snap and has never had reset()', () => {
    const s = inComponent(() => W.spring(0));
    assert.deepEqual(
      keys(s),
      ['current', 'isAnimating', 'set', 'snap', 'stop', 'subscribe', 'target', 'velocity'],
    );
    assert.equal(s.reset, undefined);
    s.stop();
  });

  it('tween takes (from, to, config) and returns a different object than spring', () => {
    const t = inComponent(() => W.tween(0, 100, { duration: 1 }));
    assert.deepEqual(keys(t), ['cancel', 'isAnimating', 'progress', 'subscribe', 'value']);
    for (const phantom of ['current', 'set', 'stop', 'reset']) {
      assert.equal(t[phantom], undefined, `tween has no ${phantom}()`);
    }
    assert.equal(t.value(), 0, 'starts at `from`');
    t.cancel();
  });

  it('useTransition drives progress; mounted/styles/show/hide never existed', () => {
    const transition = inComponent(() => W.useTransition());
    assert.deepEqual(keys(transition), ['isTransitioning', 'progress', 'start']);
    for (const phantom of ['mounted', 'styles', 'show', 'hide']) {
      assert.equal(transition[phantom], undefined, `useTransition has no ${phantom}`);
    }
  });

  it('useAnimatedValue starts animations via spring()/timing(); animateTo/stop never existed', () => {
    const animated = inComponent(() => W.useAnimatedValue(0));
    assert.deepEqual(
      keys(animated),
      ['interpolate', 'setValue', 'spring', 'subscribe', 'timing', 'value'],
    );
    assert.equal(animated.animateTo, undefined);
    assert.equal(animated.stop, undefined, 'stop lives on the handle each animation returns');
    const handle = animated.timing(10, { duration: 1 });
    assert.equal(typeof handle.stop, 'function');
    handle.stop();
  });

  it('createTransitionClasses returns the six class names, not one string', () => {
    const classes = W.createTransitionClasses('fade');
    assert.equal(typeof classes, 'object');
    assert.deepEqual(
      keys(classes),
      ['enter', 'enterActive', 'enterDone', 'exit', 'exitActive', 'exitDone'],
    );
    assert.equal(classes.enterActive, 'fade-enter-active');
  });

  it('cssTransition takes (element, name) and returns a promise', () => {
    const result = W.cssTransition(document.createElement('div'), 'fade', 'enter', 0);
    assert.ok(result instanceof Promise);
    return result;
  });

  it('useGesture returns its state object', () => {
    const gesture = inComponent(() => W.useGesture({ current: document.createElement('div') }, {}));
    assert.deepEqual(
      keys(gesture),
      ['currentX', 'currentY', 'deltaX', 'deltaY', 'isDragging', 'startX', 'startY', 'velocity'],
    );
    assert.equal(gesture.isDragging._signal, true);
    assert.equal(typeof gesture.startX, 'number', 'startX is a plain number, not a signal');
  });
});

describe('runtime shape: forms', () => {
  it('register() returns lowercase handler keys and no onInput', () => {
    const form = inComponent(() => W.useForm({ defaultValues: { email: '', agree: true } }));
    const text = form.register('email');
    assert.equal(text.onInput, undefined, 'register() has never defined onInput');
    assert.equal(typeof text.oninput, 'function');
    assert.deepEqual(keys(text), ['name', 'onBlur', 'onFocus', 'oninput', 'ref', 'value']);

    const checkbox = form.register('agree', { type: 'checkbox' });
    assert.deepEqual(keys(checkbox), ['checked', 'name', 'onBlur', 'onFocus', 'onchange', 'ref']);
  });

  it('formState exposes isValidating', () => {
    const form = inComponent(() => W.useForm({ defaultValues: {} }));
    assert.equal(typeof form.formState.isValidating, 'function');
    assert.equal(form.formState.isValidating(), false);
  });
});

describe('runtime shape: data fetching', () => {
  it('useQuery exposes fetchStatus/isIdle/isEnabled', () => {
    const query = inComponent(
      () => W.useQuery({ queryKey: ['parity-q'], queryFn: async () => 1, enabled: false }),
    );
    for (const member of ['fetchStatus', 'isIdle', 'isEnabled']) {
      assert.equal(typeof query[member], 'function', `useQuery must expose ${member}()`);
    }
    assert.equal(query.status(), 'idle');
    assert.equal(query.fetchStatus(), 'idle');
    assert.equal(query.isEnabled(), false);
  });

  it('useInfiniteQuery data() is the page CONTAINER, not a flat array', () => {
    const infinite = inComponent(
      () => W.useInfiniteQuery({ queryKey: ['parity-i'], queryFn: async () => [], enabled: false }),
    );
    const data = infinite.data();
    assert.equal(Array.isArray(data), false, 'data() is not an array; the rows are in .pages');
    assert.deepEqual(keys(data), ['pageParams', 'pages']);
    assert.deepEqual(data.pages, []);
    for (const member of ['hasPreviousPage', 'fetchPreviousPage', 'isFetching', 'isIdle', 'isEnabled']) {
      assert.equal(typeof infinite[member], 'function', `useInfiniteQuery must expose ${member}()`);
    }
  });

  it('invalidateQueries is synchronous', () => {
    assert.equal(W.invalidateQueries('parity-nothing'), undefined);
  });

  it('getQueryData is undefined for a key the cache never held, and takes array keys', () => {
    assert.equal(W.getQueryData('parity-never'), undefined);
    W.setQueryData(['parity', 1], { ok: true });
    assert.deepEqual(W.getQueryData(['parity', 1]), { ok: true });
  });

  it('useFetch data() starts null', () => {
    const fetched = inComponent(() => W.useFetch('/parity'));
    assert.equal(fetched.data(), null);
  });
});

describe('runtime shape: store', () => {
  it('a derived field reads as its value, not as the function that defines it', () => {
    const useCounter = W.createStore({
      n: 2,
      doubled: W.derived((state) => state.n * 2),
      inc() { this.n += 1; },
    });
    const store = useCounter();
    assert.equal(store.n, 2);
    assert.equal(store.doubled, 4, 'derived resolves to a value on the store object');
    assert.equal(typeof store.inc, 'function', 'actions stay callable');
    store.inc();
    assert.equal(store.doubled, 6);
  });

  it('derived() marks the function with the flag createStore actually reads', () => {
    const fn = W.derived((state) => state.n);
    assert.equal(fn._storeComputed, true);
  });
});

// =========================================================================
// 2. The declarations agree, in both directions
// =========================================================================

describe('index.d.ts matches those runtime shapes', () => {
  let results;

  before(() => {
    results = typecheck({ 'positive.ts': POSITIVE, ...NEGATIVE });
  });

  it('correct usage of every corrected signature compiles clean', () => {
    const diags = results.get('positive.ts');
    assert.deepEqual(diags, [], `expected no diagnostics, got:\n${diags.join('\n')}`);
  });

  for (const name of Object.keys(NEGATIVE)) {
    it(`rejects the pre-fix shape: ${name.replace(/^neg-|\.ts$/g, '')}`, () => {
      assert.ok(
        results.get(name).length > 0,
        `${name} compiled clean, so the declaration is back to the shape the runtime does not have `
        + '(or was widened to any)',
      );
    });
  }
});
