// useEffect and onMount run in React's order (reactive.js _holdUser,
// orderUserRound, userCleanups), checked against React itself: the same
// trees, rendered by react-dom (the repo's dev dependency) and by What, log
// the same sequence of runs and cleanups.
//
// React's order for a commit's passive effects:
// - mount: children first, siblings in order (A1, A, B, P);
// - update: every cleanup, then every run, each children first;
// - a row added to a list whose parent's effect follows the list: the
//   parent's cleanup, the row's first run, the parent's run;
// - unmount: a parent's cleanups before its children's, siblings in order;
// - within a component, its effects in the order they were declared.
//
// Two orders differ, and are pinned here: What builds a region (a reactive
// child such as `{show() ? <B /> : null}`) after the components written
// beside it, so a region's components come after their later siblings' on
// mount; and effects that run again keep the order they first ran in, so a
// row added before the rows a list had runs again after them.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(root, 'package.json'));

let cleanup;
let React;
let ReactDOMClient;

before(async () => {
  ({ cleanup } = installDOM());
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  React = require('react');
  ReactDOMClient = require('react-dom/client');
});
after(() => {
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  cleanup();
});

const settle = () => new Promise((r) => setTimeout(r, 0));

// React's log for `App`, step by step: each step's function sets state.
async function reactLog(App, steps) {
  const log = [];
  const api = {};
  const el = document.body.appendChild(document.createElement('div'));
  const rootR = ReactDOMClient.createRoot(el);
  const out = {};
  out.mount = await record(log, () => React.act(() => rootR.render(React.createElement(App, { log, api }))));
  for (const [name, step] of Object.entries(steps)) out[name] = await record(log, () => React.act(() => step(api)));
  out.unmount = await record(log, () => React.act(() => rootR.unmount()));
  el.remove();
  return out;
}

// What's log for the compiled module `mod`, with the same steps.
async function whatLog(mod, steps) {
  const el = document.body.appendChild(document.createElement('div'));
  const out = {};
  let dispose;
  out.mount = await record(mod.log, async () => { dispose = mod.run(el); await settle(); });
  for (const [name, step] of Object.entries(steps)) out[name] = await record(mod.log, async () => { step(mod); await settle(); });
  out.unmount = await record(mod.log, async () => { dispose(); await settle(); });
  el.remove();
  return out;
}

async function record(log, act) {
  log.length = 0;
  await act();
  return log.join(', ');
}

describe('useEffect runs in React\'s order', () => {
  it('a tree with a list: mount, an update of a parent and its children, rows added, unmount', async () => {
    const { createElement: h, useEffect, useState } = React;
    function C({ name, dep, log, children }) {
      useEffect(() => { log.push(`effect ${name}`); return () => log.push(`cleanup ${name}`); }, [dep]);
      return h('div', null, children);
    }
    function App({ log, api }) {
      const [tick, setTick] = useState(0);
      const [rows, setRows] = useState([1, 2]);
      Object.assign(api, { setTick, setRows });
      return h(C, { name: 'P', dep: tick, log },
        h(C, { name: 'A', dep: tick, log }, h(C, { name: 'A1', dep: tick, log })),
        h(C, { name: 'B', dep: 0, log }, h(C, { name: 'B1', dep: 0, log }, h(C, { name: 'B1a', dep: 0, log }))),
        h(C, { name: 'L', dep: rows.length, log }, rows.map((r) => h(C, { key: r, name: `row${r}`, dep: 0, log }))));
    }
    const expected = await reactLog(App, {
      update: (api) => api.setTick(1),
      append: (api) => api.setRows([1, 2, 3]),
      prepend: (api) => api.setRows([0, 1, 2, 3]),
    });

    const mod = await loadCompiled(`
      import { signal, computed, useEffect, mount } from 'what-framework';
      export const log = [];
      export const tick = signal(0);
      export const rows = signal([1, 2]);
      const zero = signal(0);
      const count = computed(() => rows().length);
      function C(props) {
        const name = props.name;
        useEffect(() => { log.push('effect ' + name); return () => log.push('cleanup ' + name); }, [props.dep]);
        return <div>{props.children}</div>;
      }
      function App() {
        return <C name="P" dep={tick}>
          <C name="A" dep={tick}><C name="A1" dep={tick} /></C>
          <C name="B" dep={zero}><C name="B1" dep={zero}><C name="B1a" dep={zero} /></C></C>
          <C name="L" dep={count}>{rows().map((r) => <C key={r} name={'row' + r} dep={zero} />)}</C>
        </C>;
      }
      export const run = (el) => mount(App, el);
    `);
    const actual = await whatLog(mod, {
      update: (m) => m.tick(1),
      append: (m) => m.rows([1, 2, 3]),
      prepend: (m) => m.rows([0, 1, 2, 3]),
    });
    assert.deepEqual(actual, expected);
    // The order itself, so a change on React's side shows here too.
    assert.equal(actual.mount, 'effect A1, effect A, effect B1a, effect B1, effect B, effect row1, effect row2, effect L, effect P');
    assert.equal(actual.update, 'cleanup A1, cleanup A, cleanup P, effect A1, effect A, effect P');
    assert.equal(actual.append, 'cleanup L, effect row3, effect L');
    assert.equal(actual.unmount, 'cleanup P, cleanup A, cleanup A1, cleanup B, cleanup B1, cleanup B1a, cleanup L, cleanup row0, cleanup row1, cleanup row2, cleanup row3');
  });

  it('several effects in a component, two writes in one batch, and a subtree a region removes', async () => {
    const { createElement: h, useEffect, useState } = React;
    function C({ name, dep, two, log, children }) {
      useEffect(() => { log.push(`effect ${name}`); return () => log.push(`cleanup ${name}`); }, [dep]);
      useEffect(() => { if (two) { log.push(`effect ${name}#2`); return () => log.push(`cleanup ${name}#2`); } }, [dep, two]);
      return h('div', null, children);
    }
    function App({ log, api }) {
      const [x, setX] = useState(0);
      const [y, setY] = useState(0);
      const [show, setShow] = useState(true);
      Object.assign(api, { setX, setY, setShow });
      return h(C, { name: 'P', dep: x, two: true, log },
        h(C, { name: 'A', dep: y, log }),
        h(C, { name: 'B', dep: y, two: true, log }, h(C, { name: 'B1', dep: x, log })),
        h(C, { name: 'Z', dep: 0, log }, show ? h(C, { name: 'Q', dep: x, log }, h(C, { name: 'Q1', dep: 0, log })) : null));
    }
    const expected = await reactLog(App, {
      both: (api) => { api.setX(1); api.setY(1); },
      y: (api) => api.setY(2),
      x: (api) => api.setX(2),
      hide: (api) => api.setShow(false),
    });

    const mod = await loadCompiled(`
      import { signal, batch, useEffect, mount } from 'what-framework';
      export const log = [];
      export const x = signal(0), y = signal(0), show = signal(true);
      const zero = signal(0);
      function C(props) {
        const name = props.name;
        useEffect(() => { log.push('effect ' + name); return () => log.push('cleanup ' + name); }, [props.dep]);
        if (props.two) useEffect(() => { log.push('effect ' + name + '#2'); return () => log.push('cleanup ' + name + '#2'); }, [props.dep]);
        return <div>{props.children}</div>;
      }
      function App() {
        return <C name="P" dep={x} two>
          <C name="A" dep={y} />
          <C name="B" dep={y} two><C name="B1" dep={x} /></C>
          <C name="Z" dep={zero}>{show() ? <C name="Q" dep={x}><C name="Q1" dep={zero} /></C> : null}</C>
        </C>;
      }
      export const run = (el) => mount(App, el);
      export const both = () => batch(() => { x(1); y(1); });
    `);
    const actual = await whatLog(mod, {
      both: (m) => m.both(),
      y: (m) => m.y(2),
      x: (m) => m.x(2),
      hide: (m) => m.show(false),
    });
    assert.deepEqual(actual, expected);
    assert.equal(actual.both, 'cleanup A, cleanup B1, cleanup B, cleanup B#2, cleanup Q, cleanup P, cleanup P#2, effect A, effect B1, effect B, effect B#2, effect Q, effect P, effect P#2');
    assert.equal(actual.hide, 'cleanup Q, cleanup Q1');
  });

  it('siblings written in the reverse of their order run again in their order', async () => {
    const { createElement: h, useEffect, useState } = React;
    function C({ name, dep, log }) {
      useEffect(() => { log.push(`effect ${name}`); return () => log.push(`cleanup ${name}`); }, [dep]);
      return h('i');
    }
    function App({ log, api }) {
      const [x, setX] = useState(0);
      const [y, setY] = useState(0);
      Object.assign(api, { setX, setY });
      return h('div', null, h(C, { name: 'A', dep: x, log }), h(C, { name: 'B', dep: y, log }), h(C, { name: 'C', dep: x, log }));
    }
    const expected = await reactLog(App, { both: (api) => { api.setY(1); api.setX(1); } });

    const mod = await loadCompiled(`
      import { signal, batch, useEffect, mount } from 'what-framework';
      export const log = [];
      export const x = signal(0), y = signal(0);
      function C(props) {
        const name = props.name;
        useEffect(() => { log.push('effect ' + name); return () => log.push('cleanup ' + name); }, [props.dep]);
        return <i />;
      }
      function App() {
        return <div><C name="A" dep={x} /><C name="B" dep={y} /><C name="C" dep={x} /></div>;
      }
      export const run = (el) => mount(App, el);
      export const both = () => batch(() => { y(1); x(1); });
    `);
    const actual = await whatLog(mod, { both: (m) => m.both() });
    assert.deepEqual(actual, expected);
    assert.equal(actual.both, 'cleanup A, cleanup B, cleanup C, effect A, effect B, effect C');
  });

  it('rows a list added later run again before the parent that renders them; between rows, in the order they were built', async () => {
    const { createElement: h, useEffect, useState } = React;
    function C({ name, dep, log, children }) {
      useEffect(() => { log.push(`effect ${name}`); return () => log.push(`cleanup ${name}`); }, [dep]);
      return h('div', null, children);
    }
    function App({ log, api }) {
      const [sel, setSel] = useState(0);
      const [rows, setRows] = useState([2, 3]);
      Object.assign(api, { setSel, setRows });
      return h(C, { name: 'P', dep: sel, log },
        h(C, { name: 'L', dep: 0, log }, rows.map((r) => h(C, { key: r, name: `row${r}`, dep: sel, log }))));
    }
    const expected = await reactLog(App, {
      add: (api) => api.setRows([1, 2, 3, 4]),
      select: (api) => api.setSel(1),
    });

    const mod = await loadCompiled(`
      import { signal, useEffect, mount } from 'what-framework';
      export const log = [];
      export const sel = signal(0);
      export const rows = signal([2, 3]);
      const zero = signal(0);
      function C(props) {
        const name = props.name;
        useEffect(() => { log.push('effect ' + name); return () => log.push('cleanup ' + name); }, [props.dep]);
        return <div>{props.children}</div>;
      }
      export const run = (el) => mount(() => <C name="P" dep={sel}>
        <C name="L" dep={zero}>{rows().map((r) => <C key={r} name={'row' + r} dep={sel} />)}</C>
      </C>, el);
    `);
    const actual = await whatLog(mod, {
      add: (m) => m.rows([1, 2, 3, 4]),
      select: (m) => m.sel(1),
    });
    // React: the rows added later (row1 first, row4 last) come before P.
    assert.equal(expected.select, 'cleanup row1, cleanup row2, cleanup row3, cleanup row4, cleanup P, effect row1, effect row2, effect row3, effect row4, effect P');
    assert.equal(actual.add, expected.add);
    // What runs a row added before the rows it found in their first-run order.
    assert.equal(actual.select, 'cleanup row2, cleanup row3, cleanup row1, cleanup row4, cleanup P, effect row2, effect row3, effect row1, effect row4, effect P');
    assert.equal(actual.unmount, expected.unmount);
  });

  it('onMount follows the same order, and runs after its children\'s', async () => {
    const mod = await loadCompiled(`
      import { onMount, useEffect, mount } from 'what-framework';
      export const log = [];
      function C(props) {
        onMount(() => log.push('mount ' + props.name));
        useEffect(() => { log.push('effect ' + props.name); }, []);
        return <div>{props.children}</div>;
      }
      export const run = (el) => mount(() => <C name="P"><C name="A"><C name="A1" /></C><C name="B" /></C>, el);
    `);
    const actual = await whatLog(mod, {});
    assert.equal(actual.mount, 'mount A1, effect A1, mount A, effect A, mount B, effect B, mount P, effect P');
  });

  it('a parent can count on its children\'s effects having run: a child that registers in an effect', async () => {
    const mod = await loadCompiled(`
      import { createContext, useContext, useEffect, mount } from 'what-framework';
      export const log = [];
      const Tabs = createContext(null);
      function TabList(props) {
        const tabs = [];
        useEffect(() => { log.push('ready ' + tabs.join(' ')); }, []);
        return <Tabs.Provider value={tabs}>{props.children}</Tabs.Provider>;
      }
      function Tab(props) {
        const tabs = useContext(Tabs);
        useEffect(() => { tabs.push(props.id); }, []);
        return <button>{props.id}</button>;
      }
      export const run = (el) => mount(() => <TabList><Tab id="a" /><Tab id="b" /></TabList>, el);
    `);
    const actual = await whatLog(mod, {});
    assert.equal(actual.mount, 'ready a b');
  });

  it('onCleanup keeps What\'s owner order: a child\'s first, newest first', async () => {
    const mod = await loadCompiled(`
      import { onCleanup, useEffect, mount } from 'what-framework';
      export const log = [];
      function C(props) {
        onCleanup(() => log.push('onCleanup ' + props.name));
        useEffect(() => () => log.push('cleanup ' + props.name), []);
        return <div>{props.children}</div>;
      }
      export const run = (el) => mount(() => <C name="P"><C name="A" /><C name="B" /></C>, el);
    `);
    const actual = await whatLog(mod, {});
    assert.equal(actual.unmount, 'cleanup P, cleanup A, cleanup B, onCleanup B, onCleanup A, onCleanup P');
  });

  it('an error a cleanup throws on unmount goes to the boundary around what unmounts, and every other cleanup runs', async () => {
    const mod = await loadCompiled(`
      import { signal, useEffect, ErrorBoundary, mount } from 'what-framework';
      export const log = [];
      export const show = signal(true);
      function C(props) {
        useEffect(() => () => { log.push('cleanup ' + props.name); if (props.fail) throw new Error('boom ' + props.name); }, []);
        return <div>{props.children}</div>;
      }
      export const run = (el) => mount(() => <ErrorBoundary fallback={({ error }) => { log.push('outer ' + error.message); return null; }}>
        <div>{show() ? <C name="P"><ErrorBoundary fallback={() => { log.push('inner'); return null; }}><C name="A" fail /></ErrorBoundary><C name="B" /></C> : null}</div>
      </ErrorBoundary>, el);
    `);
    const el = document.body.appendChild(document.createElement('div'));
    mod.run(el);
    await settle();
    mod.log.length = 0;
    mod.show(false);
    await settle();
    const cleanups = mod.log.filter((l) => l.startsWith('cleanup'));
    // The parent's first. A sits inside a boundary (built under a region of
    // its own), so it is reached after its sibling B.
    assert.equal(cleanups[0], 'cleanup P');
    assert.deepEqual([...cleanups].sort(), ['cleanup A', 'cleanup B', 'cleanup P']);
    assert.equal(mod.log.includes('outer boom A'), true, 'the boundary around what unmounts takes it');
    assert.equal(mod.log.includes('inner'), false, 'the boundary inside what unmounts does not');
    el.remove();
  });

  it('is pinned where it differs: a region\'s components mount after the components written beside it', async () => {
    const mod = await loadCompiled(`
      import { signal, useEffect, mount } from 'what-framework';
      export const log = [];
      const show = signal(true);
      function C(props) {
        useEffect(() => { log.push('effect ' + props.name); }, []);
        return <div>{props.children}</div>;
      }
      export const run = (el) => mount(() => <C name="P"><C name="A" />{show() ? <C name="B" /> : null}<C name="Z" /></C>, el);
    `);
    const actual = await whatLog(mod, {});
    // React: A, B, Z, P.
    assert.equal(actual.mount, 'effect A, effect Z, effect B, effect P');
  });
});
