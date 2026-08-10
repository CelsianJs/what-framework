// Runtime behavior of COMPILED output (SPRINT v0.11 C1/C2/C5).
// Compiles JSX through the real babel plugin, rewrites the emitted
// `what-framework`/`what-framework/render` imports to the local what-core
// sources, loads the module in jsdom, and asserts on live DOM behavior.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import babelPlugin from '../src/babel-plugin.js';

// --- jsdom globals (before importing any core module) ---
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.Node = dom.window.Node;
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_INDEX = path.resolve(__dirname, '../../core/src/index.js');
const CORE_RENDER = path.resolve(__dirname, '../../core/src/render.js');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-compiled-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

let moduleId = 0;

// Compile JSX source and import the resulting module against local core.
async function compileAndLoad(source) {
  const out = transformSync(source, {
    filename: 'fixture.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  }).code
    .replaceAll('"what-framework/render"', JSON.stringify(CORE_RENDER))
    .replaceAll("'what-framework/render'", JSON.stringify(CORE_RENDER))
    .replaceAll('"what-framework"', JSON.stringify(CORE_INDEX))
    .replaceAll("'what-framework'", JSON.stringify(CORE_INDEX));

  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, out);
  return import(pathToFileURL(file).href);
}

const { flushSync, mount } = await import(pathToFileURL(CORE_INDEX).href);

function captureWarns(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (...args) => { warns.push(args.join(' ')); };
  try { fn(); } finally { console.warn = orig; }
  return warns;
}

describe('C5: compiled output must not trip the template() guard', () => {
  it('mounting a compiled component logs NO "compiler internal" warning', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const count = signal(0);
      export function App() {
        return <div class="app"><h1>Hello</h1><p>{count()}</p></div>;
      }
    `);
    const warns = captureWarns(() => {
      const el = mod.App();
      document.body.appendChild(el);
      assert.equal(el.querySelector('h1').textContent, 'Hello');
    });
    assert.equal(
      warns.filter(w => w.includes('compiler internal')).length, 0,
      `compiled output triggered the template() guard: ${warns.join(' | ')}`
    );
  });

  it('emits an import of the internal _$template export (not the warning `template`)', () => {
    const code = transformSync('export const A = () => <div>x</div>;', {
      filename: 'a.jsx',
      plugins: [[babelPlugin, { production: false }]],
      parserOpts: { plugins: ['jsx'] },
      configFile: false,
      babelrc: false,
    }).code;
    assert.match(code, /import\s*{[^}]*_\$template[^}]*}\s*from\s*["']what-framework\/render["']/);
    assert.doesNotMatch(code, /template as _\$template/,
      'must not alias the public (warning) template export');
  });

  it('a DIRECT user call to template() still warns in dev', async () => {
    const { template } = await import(pathToFileURL(CORE_RENDER).href);
    const warns = captureWarns(() => { template('<div>direct</div>'); });
    // The warn-once flag may have a single shot per process — this test runs
    // after compiled mounts which must NOT have consumed it (C5).
    assert.equal(
      warns.filter(w => w.includes('compiler internal')).length, 1,
      `expected exactly one dev warning for direct template() use, got: ${warns.join(' | ')}`
    );
  });
});

describe('C1: branch memoization (node identity across non-flip updates)', () => {
  it('ternary child: non-flip signal write does NOT recreate branch DOM', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const count = signal(6);
      export function App() {
        return <div>{count() > 5 ? <strong>big {count()}</strong> : <em>small</em>}</div>;
      }
    `);
    const el = mod.App();
    document.body.appendChild(el);

    const firstStrong = el.querySelector('strong');
    assert.ok(firstStrong, 'taken branch rendered');
    assert.match(firstStrong.textContent, /big 6/);

    // Non-flip update: 6 -> 7 (still > 5). Branch DOM must be the SAME node.
    mod.count(7);
    flushSync();
    assert.strictEqual(el.querySelector('strong'), firstStrong,
      'branch DOM was recreated on a non-flip condition update');
    assert.match(firstStrong.textContent, /big 7/, 'fine-grained text inside the branch still updates');

    // Flip: 7 -> 3 — branch swaps.
    mod.count(3);
    flushSync();
    assert.equal(el.querySelector('strong'), null);
    assert.ok(el.querySelector('em'), 'alternate branch rendered after flip');

    // Flip back — a NEW <strong> is created (recreation on real flips is expected).
    mod.count(9);
    flushSync();
    const secondStrong = el.querySelector('strong');
    assert.ok(secondStrong);
    assert.notStrictEqual(secondStrong, firstStrong);
    el.remove();
  });

  it('logical && child: non-flip write keeps the node; falsy left value still renders', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const n = signal(4);
      export function App() {
        return <div>{n() > 3 && <span>over</span>}</div>;
      }
    `);
    const el = mod.App();
    document.body.appendChild(el);

    const span = el.querySelector('span');
    assert.ok(span);
    mod.n(10); // still > 3 — no flip
    flushSync();
    assert.strictEqual(el.querySelector('span'), span, '&& branch recreated without a flip');
    mod.n(1); // flip off
    flushSync();
    assert.equal(el.querySelector('span'), null);
    el.remove();
  });

  it('<Show>: non-flip writes do not recreate content', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const items = signal(['a']);
      export function App() {
        return <Show when={items().length} fallback={<p>empty</p>}><ul><li>list</li></ul></Show>;
      }
    `);
    // <Show> at component root compiles to a reactive function — mount via insert.
    const { insert } = await import(pathToFileURL(CORE_RENDER).href);
    const host = document.createElement('div');
    document.body.appendChild(host);
    insert(host, mod.App());

    const ul = host.querySelector('ul');
    assert.ok(ul, 'Show content rendered');
    mod.items(['a', 'b']); // length 1 -> 2: truthiness unchanged
    flushSync();
    assert.strictEqual(host.querySelector('ul'), ul,
      'Show content recreated although truthiness did not change');
    mod.items([]); // flip to fallback
    flushSync();
    assert.equal(host.querySelector('ul'), null);
    assert.ok(host.querySelector('p'));
    host.remove();
  });
});

describe('C2: specialized setters keep security + controlled-input semantics', () => {
  it('dynamic href still goes through setProp and blocks javascript: URLs', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const url = signal('javascript:alert(1)');
      export function Link() {
        return <a href={url()}>x</a>;
      }
    `);
    let el;
    const warns = captureWarns(() => { el = mod.Link(); });
    document.body.appendChild(el);
    assert.equal(el.getAttribute('href'), null, 'unsafe URL must not be set');
    assert.ok(warns.some(w => w.includes('Blocked unsafe URL')), 'sanitizer warning expected');

    mod.url('/safe');
    flushSync();
    assert.equal(el.getAttribute('href'), '/safe');
    el.remove();
  });

  it('function-valued attrs are reactive accessors (dx-testbed Test 10 regression)', async () => {
    // `value={() => user().name}` must NOT stringify the function — the
    // specialized setters treat function values as reactive accessors,
    // exactly like the generic setProp path always did.
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const user = signal({ name: 'Alice', active: true });
      export function Form() {
        return (
          <div class={() => (user().active ? 'on' : 'off')}
               data-name={() => user().name}>
            <input value={() => user().name} checked={() => user().active} />
          </div>
        );
      }
    `);
    const el = mod.Form();
    document.body.appendChild(el);
    const input = el.querySelector('input');

    assert.equal(input.value, 'Alice', 'accessor value must resolve, not stringify');
    assert.equal(input.checked, true);
    assert.equal(el.className, 'on');
    assert.equal(el.getAttribute('data-name'), 'Alice');

    mod.user({ name: 'Bob', active: false });
    flushSync();
    assert.equal(input.value, 'Bob', 'accessor value must stay reactive');
    assert.equal(input.checked, false);
    assert.equal(el.className, 'off');
    assert.equal(el.getAttribute('data-name'), 'Bob');
    el.remove();
  });

  it('class/style/data-/aria-/value/checked all update through the specialized helpers', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const on = signal(false);
      export function App() {
        return (
          <div class={on() ? 'yes' : 'no'} style={{ color: on() ? 'red' : 'blue' }}
               data-state={on() ? 'on' : null} aria-pressed={on()}>
            <input value={on() ? 'Y' : 'N'} checked={on()} />
          </div>
        );
      }
    `);
    const el = mod.App();
    document.body.appendChild(el);
    const input = el.querySelector('input');

    assert.equal(el.className, 'no');
    assert.equal(el.style.color, 'blue');
    assert.equal(el.getAttribute('data-state'), null, 'null removes data attribute');
    assert.equal(el.getAttribute('aria-pressed'), 'false', 'aria booleans stringify');
    assert.equal(input.value, 'N');
    assert.equal(input.checked, false);

    mod.on(true);
    flushSync();
    assert.equal(el.className, 'yes');
    assert.equal(el.style.color, 'red');
    assert.equal(el.getAttribute('data-state'), 'on');
    assert.equal(el.getAttribute('aria-pressed'), 'true');
    assert.equal(input.value, 'Y');
    assert.equal(input.checked, true, 'checked drives the live property');
    el.remove();
  });
});

describe('Fragment-as-root: dynamic expression children stay reactive (MEDIUM)', () => {
  // Before the fix, transformFragmentFineGrained pushed JSXExpressionContainer
  // children verbatim (no () => wrapper, no memo, no map lowering), so
  // <>{count()}</> rendered once and never updated.
  it('reactive text fragment child updates on signal change', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const count = signal(0);
      export function App() {
        return <>{count()}</>;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(mod.App(), host);

    assert.match(host.textContent, /0/, 'initial fragment text rendered');
    mod.count(5);
    flushSync();
    assert.match(host.textContent, /5/, 'fragment dynamic text updated on signal write');
    assert.doesNotMatch(host.textContent, /0/);
    host.remove();
  });

  it('reactive text fragment child mixed with a static sibling updates', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const n = signal(1);
      export function App() {
        return <><span class="label">v=</span>{n()}</>;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(mod.App(), host);

    assert.equal(host.querySelector('.label').textContent, 'v=');
    assert.match(host.textContent, /v=1/);
    mod.n(42);
    flushSync();
    assert.match(host.textContent, /v=42/, 'dynamic sibling updated; static sibling preserved');
    host.remove();
  });

  it('ternary fragment child: non-flip signal write does NOT recreate branch DOM', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const count = signal(6);
      export function App() {
        return <>{count() > 5 ? <strong>big {count()}</strong> : <em>small</em>}</>;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(mod.App(), host);

    const firstStrong = host.querySelector('strong');
    assert.ok(firstStrong, 'taken branch rendered in fragment');
    assert.match(firstStrong.textContent, /big 6/);

    // Non-flip 6 -> 7 (still > 5): same node (memoizeBranchCondition applied).
    mod.count(7);
    flushSync();
    assert.strictEqual(host.querySelector('strong'), firstStrong,
      'fragment ternary branch DOM recreated on a non-flip update');
    assert.match(firstStrong.textContent, /big 7/, 'fine-grained text inside fragment branch updates');

    // Flip 7 -> 3: branch swaps.
    mod.count(3);
    flushSync();
    assert.equal(host.querySelector('strong'), null);
    assert.ok(host.querySelector('em'), 'alternate fragment branch rendered after flip');
    host.remove();
  });

  it('keyed map fragment child lowers to _$mapArray and reconciles', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const items = signal([{ id: 1, t: 'a' }, { id: 2, t: 'b' }]);
      export function App() {
        return <>{items().map(i => <li key={i.id}>{i.t}</li>)}</>;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(mod.App(), host);

    let lis = host.querySelectorAll('li');
    assert.equal(lis.length, 2);
    assert.equal(lis[0].textContent, 'a');
    const firstLi = lis[0];

    // Append: keyed reconciliation must reuse the existing first <li> node.
    mod.items(prev => [...prev, { id: 3, t: 'c' }]);
    flushSync();
    lis = host.querySelectorAll('li');
    assert.equal(lis.length, 3, 'fragment map reconciled to 3 items');
    assert.strictEqual(lis[0], firstLi, 'keyed map reused existing node (proves _$mapArray)');
    assert.equal(lis[2].textContent, 'c');
    host.remove();
  });
});

describe('a destructured prop is not treated as a signal accessor', () => {
  // The compiler classifies every DESTRUCTURED PROP name as a signal, which is
  // right for deciding that an effect is needed and wrong for deciding to CALL
  // it. `_$createComponent` passes plain values, so `<span data-x={label}>`
  // inside `({ label })` compiled to `setAttr(el, 'data-x', label())` and threw
  //
  //   TypeError: label is not a function
  //
  // on any ordinary string prop, and the whole component subtree rendered
  // nothing. The same identifier used as a CHILD compiled to `() => label`,
  // uncalled, so the two positions disagreed inside a single element: the text
  // appeared and the attribute killed the component.
  //
  // The runtime setters (setAttr, setClass, setValue, ...) resolve a function
  // value reactively themselves, so passing the identifier through uncalled is
  // correct whether the parent passed a plain value or an accessor. Both are
  // asserted below, because fixing this by never calling would be just as wrong
  // if it broke the accessor case.

  it('renders a plain string prop in attribute position', async () => {
    const mod = await compileAndLoad(`
      export function Badge({ label, tone }) {
        return <span data-label={label} class={tone}>{label}</span>;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);

    mount(mod.Badge({ label: 'shipped', tone: 'ok' }), host);
    flushSync();

    const span = host.querySelector('span');
    assert.ok(span, 'the component must render at all');
    assert.equal(span.getAttribute('data-label'), 'shipped');
    assert.equal(span.className, 'ok');
    assert.equal(span.textContent, 'shipped', 'the child position agrees with the attribute');
    host.remove();
  });

  it('still tracks a prop that IS an accessor', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const live = signal('one');
      export function Badge({ label }) {
        return <span data-label={label}>x</span>;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);

    mount(mod.Badge({ label: mod.live }), host);
    flushSync();
    assert.equal(host.querySelector('span').getAttribute('data-label'), 'one');

    mod.live('two');
    flushSync();
    assert.equal(host.querySelector('span').getAttribute('data-label'), 'two',
      'an accessor prop must stay reactive');
    host.remove();
  });

  it('still auto-invokes a real signal from signal()', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const n = signal(1);
      export function Counter() {
        return <span data-n={n}>x</span>;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);

    mount(mod.Counter(), host);
    flushSync();
    assert.equal(host.querySelector('span').getAttribute('data-n'), '1');

    mod.n(2);
    flushSync();
    assert.equal(host.querySelector('span').getAttribute('data-n'), '2');
    host.remove();
  });

  it('works for a prop rendered through a keyed list', async () => {
    // The shape that found it: <Stat> cards built by items.map(), where one bad
    // attribute blanked the entire page rather than one card.
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const items = signal([
        { id: 1, label: 'Orders', tone: 'up' },
        { id: 2, label: 'Revenue', tone: 'down' },
      ]);
      function Stat({ label, tone }) {
        return <li data-tone={tone}>{label}</li>;
      }
      export function App() {
        return <ul>{items().map(it => <Stat key={it.id} label={it.label} tone={it.tone} />)}</ul>;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);

    mount(mod.App(), host);
    flushSync();

    const lis = [...host.querySelectorAll('li')];
    assert.equal(lis.length, 2, 'every card renders');
    assert.deepEqual(lis.map(li => li.textContent), ['Orders', 'Revenue']);
    assert.deepEqual(lis.map(li => li.getAttribute('data-tone')), ['up', 'down']);
    host.remove();
  });
});
