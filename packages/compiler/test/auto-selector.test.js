// The auto-selector: inside a keyed .map() row, `sel() === row.key` in a render
// binding is compiled to an O(1) createSelector lookup (T2-2). The rewrite must
// fire exactly when it is safe and leave everything else alone, so most of these
// tests are about when it does NOT fire.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import babelPlugin from '../src/babel-plugin.js';
import whatVitePlugin from '../src/vite-plugin.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_INDEX = path.resolve(__dirname, '../../core/src/index.js');
const CORE_RENDER = path.resolve(__dirname, '../../core/src/render.js');
const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-auto-selector-'));
let moduleId = 0;

// console.info is the dev diagnostic; keep the test output clean and countable.
function compile(source, options) {
  const info = console.info;
  const logged = [];
  console.info = (msg) => logged.push(msg);
  try {
    return { code: compileJSX(source, options), logged };
  } finally {
    console.info = info;
  }
}

const rewritten = (code) => /_\$createSelector\(/.test(code);

async function load(source) {
  const out = compile(source).code
    .replaceAll('"what-framework/render"', JSON.stringify(CORE_RENDER))
    .replaceAll('"what-framework"', JSON.stringify(CORE_INDEX))
    .replaceAll("'what-framework'", JSON.stringify(CORE_INDEX));
  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, out);
  return import(pathToFileURL(file).href);
}

const { mount, flushSync } = await import(pathToFileURL(CORE_INDEX).href);

const TABLE = (binding, extra = '') => `
  import { signal } from 'what-framework';
  ${extra}
  export function Table() {
    const selected = signal(0);
    const rows = signal([{ id: 1 }, { id: 2 }]);
    return <ul>{rows().map(row => <li key={row.id} ${binding}>{row.id}</li>)}</ul>;
  }
`;

describe('auto-selector: where it fires', () => {
  it('rewrites sel() === row.key in a component prop, a live prop the component reads in its bindings', async () => {
    const source = `
      import { signal } from 'what-framework';
      export const selected = signal(0);
      export const rows = signal([1, 2, 3]);
      export const runs = { n: 0 };
      function Row({ id, active }) { return <li class={(runs.n++, active ? 'on' : '')}>{id}</li>; }
      export function T() {
        return <ul>{rows().map(id => <Row key={id} id={id} active={selected() === id} />)}</ul>;
      }
    `;
    const { code } = compile(source);
    assert.match(code, /get active\(\) \{\s*return _sel\$0\(id\);/, code);
    const mod = await load(source);
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      mount(() => mod.T(), host);
      flushSync();
      mod.runs.n = 0;
      mod.selected(2);
      flushSync();
      assert.deepEqual([...host.querySelectorAll('li')].map((li) => li.className), ['', 'on', '']);
      assert.equal(mod.runs.n, 1, 'only the row it selects re-ran');
      mod.selected(3);
      flushSync();
      assert.deepEqual([...host.querySelectorAll('li')].map((li) => li.className), ['', '', 'on']);
      assert.equal(mod.runs.n, 3, 'the row it left and the row it entered');
    } finally {
      host.remove();
    }
  });

  it('rewrites sel() === row.key in a class binding', () => {
    const { code } = compile(TABLE(`class={selected() === row.id ? 'on' : ''}`));
    assert.match(code, /const _sel\$0 = _\$createSelector\(selected\);/);
    assert.match(code, /_\$className\(_el\$\d+, _sel\$0\(row\.id\) \? 'on' : ''\)/);
    assert.match(code, /createSelector as _\$createSelector/);
  });

  it('accepts either operand order and !==', () => {
    assert.match(compile(TABLE(`class={row.id === selected() ? 'on' : ''}`)).code, /_sel\$0\(row\.id\)/);
    assert.match(compile(TABLE(`class={selected() !== row.id ? 'off' : 'on'}`)).code, /!_sel\$0\(row\.id\)/);
  });

  it('rewrites a child expression, a render thunk and a nested element of the row', () => {
    const code = compile(`
      import { signal } from 'what-framework';
      export function T() {
        const sel = signal(0);
        const rows = signal([]);
        return <ul>{rows().map(r => (
          <li key={r.id}>
            {sel() === r.id ? 'yes' : 'no'}
            <b title={() => (sel() === r.id ? 'b' : '')}>{() => sel() === r.id}</b>
          </li>
        ))}</ul>;
      }
    `).code;
    assert.equal((code.match(/_sel\$0\(r\.id\)/g) || []).length, 3, code);
    assert.equal((code.match(/_\$createSelector\(/g) || []).length, 1, 'one selector per source per list');
  });

  it('rewrites a prop accessor and an imported accessor', () => {
    const prop = compile(`
      export function T({ selected, rows }) {
        return <ul>{rows().map(r => <li key={r.id} class={selected() === r.id ? 'on' : ''} />)}</ul>;
      }
    `).code;
    assert.ok(rewritten(prop), prop);
    const imported = compile(`
      import { selected } from './store.js';
      export function T({ rows }) {
        return <ul>{rows().map(r => <li key={r.id} class={selected() === r.id ? 'on' : ''} />)}</ul>;
      }
    `).code;
    assert.ok(rewritten(imported), imported);
  });

  it('gives each level of nested lists its own selector, declared inside the outer row', () => {
    const code = compile(`
      import { signal } from 'what-framework';
      export function T() {
        const group = signal(0);
        const item = signal(0);
        const groups = signal([]);
        return <div>{groups().map(g => (
          <section key={g.id} class={group() === g.id ? 'g' : ''}>
            <ul>{g.items.map(i => <li key={i.id} class={item() === i.id ? 'i' : ''} />)}</ul>
          </section>
        ))}</div>;
      }
    `).code;
    assert.match(code, /_\$createSelector\(group\)/);
    assert.match(code, /_\$createSelector\(item\)/);
    // The outer row reads `g.items`, so it takes its item through an accessor:
    // `(accessor, index, g) => {`.
    const outerRow = code.indexOf('g) => {');
    assert.ok(outerRow > 0 && code.indexOf('_$createSelector(item)') > outerRow, 'the inner selector lives in the outer row');
  });
});

describe('auto-selector: where it does not fire', () => {
  const cases = {
    'a plain local function': [`class={pick() === row.id ? 'on' : ''}`, 'const pick = () => 1;'],
    'a member call': [`class={store.sel() === row.id ? 'on' : ''}`, 'const store = { sel: () => 1 };'],
    'a call with arguments': [`class={selected(1) === row.id ? 'on' : ''}`],
    'a non-call identifier': [`class={selected === row.id ? 'on' : ''}`],
    'loose equality': [`class={selected() == row.id ? 'on' : ''}`],
    'a key with a call in it': [`class={selected() === row.key() ? 'on' : ''}`],
    'a key that does not read the row': [`class={selected() === 3 ? 'on' : ''}`],
    'an event handler': [`onClick={() => selected() === row.id && selected(0)}`],
    'a ref': [`ref={(el) => selected() === row.id && el}`],
  };
  for (const [label, [binding, extra]] of Object.entries(cases)) {
    it(label, () => {
      const { code } = compile(TABLE(binding, extra));
      assert.ok(!rewritten(code), code);
    });
  }

  it('a reassigned binding', () => {
    const { code } = compile(`
      import { signal } from 'what-framework';
      export function T() {
        let selected = signal(0);
        selected = signal(1);
        const rows = signal([]);
        return <ul>{rows().map(row => <li key={row.id} class={selected() === row.id ? 'on' : ''} />)}</ul>;
      }
    `);
    assert.ok(!rewritten(code), code);
  });

  it('a name the row itself binds', () => {
    const { code } = compile(`
      import { signal } from 'what-framework';
      export function T() {
        const selected = signal(0);
        const rows = signal([]);
        return <ul>{rows().map((row, selected) => <li key={row.id} class={selected() === row.id ? 'on' : ''} />)}</ul>;
      }
    `);
    assert.ok(!rewritten(code), code);
  });

  it('a function handed to a component prop (the component calls it)', () => {
    const { code } = compile(`
      import { signal } from 'what-framework';
      function Row(props) { return <li>{props.active() ? 'x' : ''}</li>; }
      export function T() {
        const selected = signal(0);
        const rows = signal([]);
        return <ul>{rows().map(row => <Row key={row.id} active={() => selected() === row.id} />)}</ul>;
      }
    `);
    assert.ok(!rewritten(code), code);
  });

  it('an unkeyed .map()', () => {
    const { code } = compile(`
      import { signal } from 'what-framework';
      export function T() {
        const selected = signal(0);
        const rows = signal([]);
        return <ul>{rows().map(row => <li class={selected() === row.id ? 'on' : ''} />)}</ul>;
      }
    `);
    assert.ok(!rewritten(code), code);
  });
});

describe('auto-selector: opting out', () => {
  it('per comparison', () => {
    const { code } = compile(TABLE(`class={/* @what-no-selector */ selected() === row.id ? 'on' : ''}`));
    assert.ok(!rewritten(code), code);
  });

  it('per list', () => {
    const { code } = compile(`
      import { signal } from 'what-framework';
      export function T() {
        const selected = signal(0);
        const rows = signal([]);
        return <ul>{/* @what-no-selector */ rows().map(row => <li key={row.id} class={selected() === row.id ? 'on' : ''} />)}</ul>;
      }
    `);
    assert.ok(!rewritten(code), code);
  });

  it('for a whole build', () => {
    const { code } = compile(TABLE(`class={selected() === row.id ? 'on' : ''}`), { pluginOptions: { autoSelector: false } });
    assert.ok(!rewritten(code), code);
  });

  it('for a whole build through the Vite plugin', () => {
    const source = TABLE(`class={selected() === row.id ? 'on' : ''}`);
    const transform = (options) => {
      const info = console.info;
      console.info = () => {};
      try {
        return whatVitePlugin({ production: true, ...options }).transform.call({}, source, '/app/src/Table.jsx').code;
      } finally {
        console.info = info;
      }
    };
    assert.ok(rewritten(transform({})), 'on by default');
    assert.ok(rewritten(transform({ autoSelector: true })));
    assert.ok(!rewritten(transform({ autoSelector: false })));
  });
});

describe('auto-selector: diagnostics', () => {
  it('explains the rewrite once per file in development', () => {
    const { logged } = compile(`
      import { signal } from 'what-framework';
      export function T() {
        const selected = signal(0);
        const rows = signal([]);
        return <ul>{rows().map(row => <li key={row.id} class={selected() === row.id ? 'on' : ''} title={selected() === row.id ? 't' : ''} />)}</ul>;
      }
    `, { filename: 'diag-once.jsx' });
    assert.equal(logged.length, 1);
    assert.match(logged[0], /auto-selector: `selected\(\) === row\.id`/);
    assert.match(logged[0], /diag-once\.jsx:\d+:\d+/);
    assert.match(logged[0], /@what-no-selector/);
  });

  it('stays quiet in production builds', () => {
    const { logged } = compile(TABLE(`class={selected() === row.id ? 'on' : ''}`), { production: true, filename: 'diag-prod.jsx' });
    assert.equal(logged.length, 0);
  });

  it('lists every rewrite in the file metadata', () => {
    const result = transformSync(TABLE(`class={selected() === row.id ? 'on' : ''}`), {
      filename: 'meta.jsx',
      plugins: [[babelPlugin, { production: true }]],
      parserOpts: { plugins: ['jsx'] },
      configFile: false,
      babelrc: false,
    });
    assert.deepEqual(result.metadata.whatAutoSelectors.map(r => [r.source, r.comparison]), [['selected', 'selected() === row.id']]);
  });
});

describe('auto-selector: behaviour', () => {
  it('renders the same classes and re-runs only the rows whose selection changed', async () => {
    const mod = await load(`
      import { signal } from 'what-framework';
      export const selected = signal(2);
      export const rows = signal([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
      export const writes = [];
      const mark = (id, on) => { writes.push(id); return on ? 'on' : ''; };
      export function List() {
        return <ul>{rows().map(row => (
          <li key={row.id} class={mark(row.id, selected() === row.id)}>{row.id}</li>
        ))}</ul>;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(mod.List(), host);
    const classes = () => [...host.querySelectorAll('li')].map(li => li.className);
    assert.deepEqual(classes(), ['', 'on', '', '']);

    mod.writes.length = 0;
    mod.selected(4);
    flushSync();
    assert.deepEqual(classes(), ['', '', '', 'on']);
    assert.deepEqual(mod.writes.sort(), [2, 4], 'only the rows leaving and entering the selection re-ran');

    mod.rows([{ id: 4 }, { id: 5 }]);
    flushSync();
    mod.selected(5);
    flushSync();
    assert.deepEqual(classes(), ['', 'on'], 'rows added later are selectable');
    host.remove();
  });
});

describe('auto-selector: the hoisted selector is safe by construction', () => {
  it('a list whose comparison is guarded by an optional accessor prop renders with and without it', async () => {
    const mod = await load(`
      import { signal } from 'what-framework';
      export const rows = signal([1, 2]);
      export const s = signal(2);
      function List({ selected }) {
        return <ul>{rows().map(id => <li key={id} class={selected && selected() === id ? 'sel' : ''}>{id}</li>)}</ul>;
      }
      export const without = () => <List />;
      export const withSelection = () => <List selected={s} />;
    `);
    const render = (build) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      mount(build, host);
      flushSync();
      return host;
    };
    const classes = (host) => [...host.querySelectorAll('li')].map(li => li.textContent + (li.className ? '*' : ''));
    const bare = render(mod.without);
    assert.deepEqual(classes(bare), ['1', '2']);
    const selecting = render(mod.withSelection);
    assert.deepEqual(classes(selecting), ['1', '2*']);
    mod.s(1);
    flushSync();
    assert.deepEqual(classes(selecting), ['1*', '2']);
    bare.remove();
    selecting.remove();
  });

  it('checks a source it cannot prove is an accessor before creating the selector', () => {
    const prop = compile(`
      export function T({ selected, rows }) {
        return <ul>{rows().map(r => <li key={r.id} class={selected() === r.id ? 'on' : ''} />)}</ul>;
      }
    `).code;
    // A destructured prop is read through props where it is used (common.js
    // deferPlacedProps), so the source is `_props.selected`.
    assert.match(prop, /const _sel\$0 = typeof _props\.selected === "function" \? _\$createSelector\(_props\.selected\) : _k\$0 => _props\.selected\(\) === _k\$0;/);
    const local = compile(TABLE(`class={selected() === row.id ? 'on' : ''}`)).code;
    assert.match(local, /const _sel\$0 = _\$createSelector\(selected\);/, 'a local signal needs no check');
  });

  it('a non-function source raises exactly what the comparison as written raises, and only when a row reads it', async () => {
    const mod = await load(`
      import { signal } from 'what-framework';
      export const rows = signal([1, 2]);
      export function List({ selected }) {
        return <ul>{rows().map(id => <li key={id} class={selected() === id ? 'sel' : ''}>{id}</li>)}</ul>;
      }
    `);
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      mod.rows([]);
      mount(() => mod.List({ selected: 'not-a-function' }), host);
      flushSync();
      assert.equal(host.querySelectorAll('li').length, 0, 'creating the selector did not throw');
      host.textContent = '';
      mod.rows([1, 2]);
      assert.throws(() => { mount(() => mod.List({ selected: 'not-a-function' }), host); flushSync(); }, /selected is not a function/);
    } finally {
      host.remove();
    }
  });

  it('two lists comparing the same source in one component share one selector', async () => {
    const mod = await load(`
      import { signal } from 'what-framework';
      export const selected = signal(1);
      export const a = signal([1, 2]);
      export const b = signal([2, 3]);
      export function Two() {
        return <div>
          <ul>{a().map(id => <li key={id} class={selected() === id ? 'on' : ''}>{id}</li>)}</ul>
          <ol>{b().map(id => <li key={id} class={selected() === id ? 'on' : ''}>{id}</li>)}</ol>
        </div>;
      }
    `);
    const code = compile(`
      import { signal } from 'what-framework';
      export function Two() {
        const selected = signal(1);
        const a = signal([]);
        const b = signal([]);
        return <div>
          <ul>{a().map(id => <li key={id} class={selected() === id ? 'on' : ''} />)}</ul>
          <ol>{b().map(id => <li key={id} class={selected() !== id ? 'off' : ''} />)}</ol>
        </div>;
      }
    `).code;
    assert.equal((code.match(/_\$createSelector\(/g) || []).length, 1, code);
    assert.equal((code.match(/_sel\$0\(id\)/g) || []).length, 2, code);

    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(mod.Two, host);
    flushSync();
    const on = () => [...host.querySelectorAll('li.on')].map(li => li.textContent);
    assert.deepEqual(on(), ['1']);
    mod.selected(2);
    flushSync();
    assert.deepEqual(on(), ['2', '2']);
    host.remove();
  });
});
