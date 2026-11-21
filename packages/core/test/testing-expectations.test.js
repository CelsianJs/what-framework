// expectRuns() and expectDiagnostic() counts, and the effect owners
// captureDiagnostics() records for expectRuns({ component }).
//
// A count assertion that passes for the wrong reason is worse than none: a
// misspelled effect name used to pass as zero runs, and a component's budget
// could not be asserted at all. So every option is pinned with the input that
// passes and the input that fails, and every failure with its message.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { installDOM } from '../../../test-utils/dom.js';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

installDOM();

const reactive = await import('../src/reactive.js');
const { signal, computed, effect, createRoot, flushSync, __setDevToolsHooks } = reactive;
const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { useEffect } = await import('../src/hooks.js');
const { report } = await import('../src/diagnostics.js');
const { captureDiagnostics, expectRuns, expectDiagnostic, render, cleanup } = await import('../src/testing.js');

afterEach(() => cleanup());

// Header holds a computed, an effect, an effect that this interaction leaves
// alone, one Label, and a region that renders a second Label on demand.
function headerApp() {
  const title = signal('a', 'title');
  const other = signal(0, 'other');
  const more = signal(false, 'more');
  function Label() {
    effect(function labelSync() { title(); });
    return h('span', null, () => title());
  }
  function Header() {
    const upper = computed(function upperTitle() { return title().toUpperCase(); });
    effect(function headerSync() { upper(); });
    effect(function idleSync() { other(); });
    return h('header', null, h(Label), () => (more() ? h(Label) : null));
  }
  return { title, more, Header };
}

function find(cap, name) {
  return cap.effects.filter((e) => e.name === name);
}

describe('captureDiagnostics effects', () => {
  it('lists each effect and computed with its owner path, including the known ones that did not run', () => {
    const { title, Header } = headerApp();
    render(h(Header));
    const cap = captureDiagnostics(() => {
      title('b');
      flushSync();
    });

    assert.deepEqual(find(cap, 'upperTitle'), [{ name: 'upperTitle', kind: 'computed', owner: ['<Header>'], runs: 1 }]);
    assert.deepEqual(find(cap, 'headerSync'), [{ name: 'headerSync', kind: 'effect', owner: ['<Header>'], runs: 1 }]);
    assert.deepEqual(find(cap, 'idleSync'), [{ name: 'idleSync', kind: 'effect', owner: ['<Header>'], runs: 0 }]);
    assert.deepEqual(find(cap, 'labelSync'), [{ name: 'labelSync', kind: 'effect', owner: ['<Header>', '<Label>'], runs: 1 }]);
    assert.deepEqual(cap.runs, { upperTitle: 1, headerSync: 1, labelSync: 1, '(anonymous)': 1 }, 'runs lists only what ran');
  });

  it('gives a component a region renders during the capture its full path', () => {
    const { more, Header } = headerApp();
    render(h(Header));
    const cap = captureDiagnostics(() => {
      more(true);
      flushSync();
    });
    const labels = find(cap, 'labelSync');
    assert.equal(labels.length, 2, 'the first Label, idle, and the one the region rendered');
    assert.deepEqual(labels.map((e) => [e.owner, e.runs]), [[['<Header>', '<Label>'], 0], [['<Header>', '<Label>'], 1]]);
  });

  it('gives an effect created by an effect re-run the owner of the effect that created it', () => {
    const n = signal(0, 'n');
    function Panel() {
      effect(function outer() {
        n();
        effect(function nested() {});
      });
      return h('div');
    }
    render(h(Panel));
    const cap = captureDiagnostics(() => {
      n(1);
      flushSync();
    });
    assert.deepEqual(find(cap, 'nested').map((e) => e.owner), [['<Panel>']]);
  });

  it('keeps the owner of an effect that ran and was disposed within the capture', () => {
    const { more, Header } = headerApp();
    render(h(Header));
    const cap = captureDiagnostics(() => {
      more(true);
      flushSync();
      more(false);
      flushSync();
    });
    assert.deepEqual(find(cap, 'labelSync').map((e) => [e.owner, e.runs]), [[['<Header>', '<Label>'], 0], [['<Header>', '<Label>'], 1]]);
  });

  it('reads each owner from the owner tree: null outside any component, the component for a deferred callback or a tree mounted outside render()', async () => {
    const n = signal(0, 'n');
    let disposeEarly;
    createRoot((d) => {
      disposeEarly = d;
      effect(function beforeWatching() { n(); });
    });
    const unmountPlain = mount(h(function Plain() {
      effect(function plainMount() { n(); });
      return h('div');
    }), document.createElement('div'));
    function Search() {
      useEffect(function deferred() {
        n();
        effect(function fromDeferred() { n(); });
      });
      return h('div');
    }
    render(h(Search));
    await Promise.resolve();
    let disposeInside;
    try {
      const cap = captureDiagnostics(() => {
        createRoot((d) => {
          disposeInside = d;
          effect(function inRoot() { n(); });
        });
        n(1);
        flushSync();
      });
      assert.equal(find(cap, 'beforeWatching')[0].owner, null, 'created in a createRoot outside any component');
      assert.equal(find(cap, 'inRoot')[0].owner, null, 'created in createRoot, with no component rendering');
      assert.ok(cap.effects.some((e) => e.name === '(anonymous)' && e.runs === 1 && e.owner?.join() === '<Search>'), 'useEffect belongs to its component');
      assert.deepEqual(find(cap, 'fromDeferred').map((e) => e.owner), [['<Search>'], ['<Search>']], 'an effect a useEffect run creates belongs to the component too: the first run\'s, disposed by the re-run, and the re-run\'s');
      assert.deepEqual(find(cap, 'plainMount')[0].owner, ['<Plain>'], 'mounted with mount(), outside render() and the capture');
    } finally {
      disposeEarly();
      disposeInside();
      unmountPlain();
    }
  });

  it('attributes the effects of keyed rows and of regions to the component that renders them', () => {
    const items = signal([{ id: 1 }, { id: 2 }], 'items');
    const tick = signal(0, 'tick');
    function Row(props) {
      effect(function rowSync() { tick(); props.item.id; });
      return h('li', null, String(props.item.id));
    }
    function List() {
      return h('ul', null, () => items().map((item) => h(Row, { key: item.id, item })));
    }
    function Page() {
      return h('main', null, h(List), () => (tick() > 0 ? h('p', null, h(function Note() {
        effect(function noteSync() { tick(); });
        return 'note';
      })) : null));
    }
    render(h(Page));
    const cap = captureDiagnostics(() => {
      items([...items(), { id: 3 }]);
      tick(1);
      flushSync();
    });
    assert.deepEqual([...new Set(find(cap, 'rowSync').map((e) => e.owner.join(' › ')))], ['<Page> › <List> › <Row>']);
    assert.equal(find(cap, 'rowSync').length, 3, 'two rows that re-ran and the row the update added');
    assert.deepEqual(find(cap, 'noteSync').map((e) => e.owner), [['<Page>', '<Note>']]);
    assert.doesNotThrow(() => expectRuns(cap, { component: 'Row', effect: 'rowSync', exact: 3 }));
    assert.doesNotThrow(() => expectRuns(cap, { component: 'List', effect: 'rowSync', exact: 3 }));
    assert.doesNotThrow(() => expectRuns(cap, { component: 'Page', effect: 'noteSync', exact: 1 }));
  });

  it('watches creations only while a tree render() mounted is alive, and restores the hooks after', () => {
    const before = reactive.__devtools;
    const { Header } = headerApp();
    const view = render(h(Header));
    assert.notEqual(reactive.__devtools, before, 'the watch is installed while the tree is mounted');
    view.unmount();
    assert.equal(reactive.__devtools, before, 'and removed with it');
  });

  it('wraps hooks installed over its own, counting runs again, with owners still read from the owner tree', () => {
    const before = reactive.__devtools;
    const { title, Header } = headerApp();
    render(h(Header));
    const seen = [];
    const hooks = { onEffectRun: () => seen.push('run') };
    __setDevToolsHooks(hooks);
    try {
      const cap = captureDiagnostics(() => {
        title('b');
        flushSync();
      });
      assert.equal(cap.runs.headerSync, 1, 'the capture still counts runs');
      assert.ok(seen.length >= 1, 'the installed hooks still receive them');
      assert.deepEqual(find(cap, 'headerSync')[0].owner, ['<Header>'], 'the owner tree, not the watch, names the component');
      cleanup();
      assert.equal(reactive.__devtools, hooks, 'the installed hooks are left in place');
    } finally {
      __setDevToolsHooks(before);
    }
  });
});

describe('expectRuns', () => {
  const effects = [
    { name: 'rowSync', kind: 'effect', owner: ['<App>', '<List>', '<Row>'], runs: 3 },
    { name: 'rowSync', kind: 'effect', owner: ['<App>', '<List>', '<Row>'], runs: 1 },
    { name: 'checkbox', kind: 'effect', owner: ['<App>', '<List>', '<Row>', '<Check>'], runs: 2 },
    { name: 'total', kind: 'computed', owner: ['<App>'], runs: 1 },
    { name: 'headerSync', kind: 'effect', owner: ['<App>', '<Header>'], runs: 0 },
  ];
  const cap = { effects };

  it('takes exact, min, max or a min-max range for one effect', () => {
    assert.doesNotThrow(() => expectRuns(cap, { effect: 'rowSync', exact: 4 }));
    assert.doesNotThrow(() => expectRuns(cap, { effect: 'rowSync', min: 4 }));
    assert.doesNotThrow(() => expectRuns(cap, { effect: 'rowSync', max: 4 }));
    assert.doesNotThrow(() => expectRuns(cap, { effect: 'rowSync', min: 2, max: 5 }));
    assert.throws(() => expectRuns(cap, { effect: 'rowSync', exact: 3 }), /Expected effect "rowSync" to run exactly 3 time\(s\), it ran 4\.\nAll runs:\n {2}rowSync: 4 in <App> › <List> › <Row>\n/);
    assert.throws(() => expectRuns(cap, { effect: 'rowSync', min: 5 }), /to run at least 5 time\(s\), it ran 4\./);
    assert.throws(() => expectRuns(cap, { effect: 'rowSync', max: 3 }), /to run at most 3 time\(s\), it ran 4\./);
    assert.throws(() => expectRuns(cap, { effect: 'rowSync', min: 5, max: 9 }), /to run between 5 and 9 times, it ran 4\./);
  });

  it('defaults to at least once', () => {
    assert.doesNotThrow(() => expectRuns(cap, { effect: 'total' }));
    assert.throws(() => expectRuns(cap, { effect: 'headerSync' }), /Expected effect "headerSync" to run at least 1 time\(s\), it ran 0\./);
  });

  it('counts every effect and computed run of the capture when given no effect or component', () => {
    assert.doesNotThrow(() => expectRuns(cap, { exact: 7 }));
    assert.throws(() => expectRuns(cap, { max: 5 }), (err) => {
      assert.match(err.message, /^Expected all effects together to run at most 5 time\(s\), they ran 7\./);
      assert.match(err.message, /total \(computed\): 1 in <App>/);
      assert.doesNotMatch(err.message, /headerSync/, 'an effect that did not run is not listed as a run');
      return true;
    });
    assert.doesNotThrow(() => expectRuns({ effects: [] }, { exact: 0 }), 'the whole interaction may do nothing');
    assert.throws(() => expectRuns({ effects: [] }, { min: 1 }), /they ran 0\.\nNo effect ran during the capture\./);
  });

  it('throws for an effect name that matches nothing, listing what ran', () => {
    assert.throws(() => expectRuns(cap, { effect: 'rowSnyc', max: 0 }), (err) => {
      assert.match(err.message, /^Expected effect "rowSnyc" to run exactly 0 time\(s\), but no effect named "rowSnyc" ran or was known to exist during the capture\./);
      assert.match(err.message, /All runs:\n {2}rowSync: 4 in <App> › <List> › <Row>\n {2}checkbox: 2 in <App> › <List> › <Row> › <Check>\n {2}total \(computed\): 1 in <App>$/);
      return true;
    });
    assert.doesNotThrow(() => expectRuns(cap, { effect: 'headerSync', exact: 0 }), 'a known effect that did not run matches');
  });

  it('scopes to a component and the components inside it, across instances', () => {
    assert.doesNotThrow(() => expectRuns(cap, { component: 'Row', exact: 6 }));
    assert.doesNotThrow(() => expectRuns(cap, { component: 'Check', exact: 2 }));
    assert.doesNotThrow(() => expectRuns(cap, { component: 'Header', exact: 0 }), 'a component whose effects all stayed idle');
    assert.doesNotThrow(() => expectRuns(cap, { component: 'Row', effect: 'rowSync', exact: 4 }));
    assert.throws(() => expectRuns(cap, { component: 'Row', max: 5 }), /Expected effects in <Row> to run at most 5 time\(s\), they ran 6\./);
    assert.throws(() => expectRuns(cap, { component: 'Row', effect: 'rowSync', max: 1 }), /Expected effect "rowSync" in <Row> to run at most 1 time\(s\), it ran 4\./);
  });

  it('throws for a component, or a name within one, that matches nothing', () => {
    assert.throws(() => expectRuns(cap, { component: 'Rwo', max: 1 }), /Expected effects in <Rwo> to run at most 1 time\(s\), but no effect created in <Rwo> ran or was known to exist during the capture\.[\s\S]*All runs:/);
    assert.throws(() => expectRuns(cap, { component: 'Header', effect: 'rowSync', max: 1 }), /no effect named "rowSync" created in <Header> ran or was known to exist/);
  });

  describe('with effects outside any component', () => {
    const mixed = {
      effects: [
        { name: 'rowSync', kind: 'effect', owner: ['<App>', '<Row>'], runs: 2 },
        { name: 'persist', kind: 'effect', owner: null, runs: 3 },
        { name: 'remaining', kind: 'computed', owner: null, runs: 1 },
      ],
    };

    it('counts them in no component', () => {
      assert.doesNotThrow(() => expectRuns(mixed, { component: 'Row', exact: 2 }));
      assert.throws(() => expectRuns(mixed, { component: 'Row', max: 1 }), (err) => {
        assert.match(err.message, /^Expected effects in <Row> to run at most 1 time\(s\), they ran 2\./);
        assert.match(err.message, / {2}persist: 3 · outside any component\n {2}rowSync: 2 in <App> › <Row>\n {2}remaining \(computed\): 1 · outside any component$/);
        return true;
      });
      assert.throws(() => expectRuns(mixed, { component: 'Search', max: 9 }), /no effect created in <Search> ran or was known to exist/);
    });

    it('counts them by name and in the whole interaction', () => {
      assert.doesNotThrow(() => expectRuns(mixed, { effect: 'persist', exact: 3 }));
      assert.doesNotThrow(() => expectRuns(mixed, { exact: 6 }));
    });
  });

  it('works on a real capture of one interaction', () => {
    const { title, Header } = headerApp();
    render(h(Header));
    const captured = captureDiagnostics(() => {
      title('b');
      flushSync();
    });
    expectRuns(captured, { component: 'Label', exact: 2 });
    expectRuns(captured, { component: 'Header', exact: 4 });
    expectRuns(captured, { effect: 'idleSync', exact: 0 });
    expectRuns(captured, { max: 4 });
  });

  it('rejects options it cannot honour', () => {
    const cases = [
      [null, /expectRuns\(\) takes an options object: \{ effect, component, exact, min, max \}/],
      [{ efect: 'rowSync', max: 1 }, /unknown option "efect"\. The options are effect, component, exact, min, max\./],
      [{ exact: 1, max: 2 }, /exact cannot be combined with min or max/],
      [{ min: 3, max: 2 }, /min \(3\) is greater than max \(2\)/],
      [{ max: -1 }, /max must be a whole number of 0 or more, got -1/],
      [{ exact: 1.5 }, /exact must be a whole number of 0 or more, got 1\.5/],
      [{ effect: '', max: 1 }, /effect must be a non-empty string/],
      [{ component: 42, max: 1 }, /component must be a non-empty string, got 42/],
    ];
    for (const [options, message] of cases) {
      assert.throws(() => expectRuns(cap, /** @type {any} */ (options)), (err) => err instanceof TypeError && message.test(err.message));
    }
  });
});

describe('expectDiagnostic', () => {
  const ctx = (n, count) => ({
    seq: n, code: 'ERR_CONTEXT_NOT_PROVIDED', severity: 'warning', message: `Theme${n} was read with no provider.`,
    fix: 'Render the reader inside a provider.', owner: [], loc: null, subject: null, data: {}, count,
  });

  it('adds up the folded count of every event with the code', () => {
    const cap = { events: [ctx(1, 2), ctx(2, 1)] };
    assert.doesNotThrow(() => expectDiagnostic(cap, { code: 'ERR_CONTEXT_NOT_PROVIDED', exact: 3 }));
    assert.doesNotThrow(() => expectDiagnostic(cap, { code: 'ERR_CONTEXT_NOT_PROVIDED', min: 3 }));
    assert.doesNotThrow(() => expectDiagnostic(cap, { code: 'ERR_CONTEXT_NOT_PROVIDED', max: 3 }));
    assert.throws(() => expectDiagnostic(cap, { code: 'ERR_CONTEXT_NOT_PROVIDED', exact: 1 }), (err) => {
      assert.match(err.message, /^Expected ERR_CONTEXT_NOT_PROVIDED exactly 1 time\(s\), got 3:\n/);
      assert.match(err.message, /ERR_CONTEXT_NOT_PROVIDED ×2 Theme1 was read/);
      assert.match(err.message, /fix: Render the reader inside a provider\./);
      return true;
    });
    assert.throws(() => expectDiagnostic(cap, { code: 'ERR_CONTEXT_NOT_PROVIDED', max: 2 }), /Expected ERR_CONTEXT_NOT_PROVIDED at most 2 time\(s\), got 3:/);
    assert.throws(() => expectDiagnostic(cap, { code: 'ERR_CONTEXT_NOT_PROVIDED', min: 4 }), /Expected ERR_CONTEXT_NOT_PROVIDED at least 4 time\(s\), got 3:/);
    assert.throws(() => expectDiagnostic({ events: [] }, { code: 'ERR_CONTEXT_NOT_PROVIDED', exact: 1 }), /Expected ERR_CONTEXT_NOT_PROVIDED exactly 1 time\(s\), got none\.$/);
  });

  it('still requires that code and nothing else, whatever the count', () => {
    const cap = { events: [ctx(1, 1), { ...ctx(2, 1), code: 'ERR_STORAGE_FAILED' }] };
    assert.throws(() => expectDiagnostic(cap, { code: 'ERR_CONTEXT_NOT_PROVIDED', exact: 1 }), /Expected exactly ERR_CONTEXT_NOT_PROVIDED, got:[\s\S]*ERR_STORAGE_FAILED/);
  });

  it('counts repeats a real capture folded into one event', () => {
    const subject = { kind: 'context', name: 'Theme' };
    const cap = captureDiagnostics(() => {
      report('ERR_CONTEXT_NOT_PROVIDED', { data: { context: 'Theme' }, subject });
      report('ERR_CONTEXT_NOT_PROVIDED', { data: { context: 'Theme' }, subject });
    });
    assert.equal(cap.events.length, 1);
    assert.equal(cap.events[0].count, 2);
    expectDiagnostic(cap, { code: 'ERR_CONTEXT_NOT_PROVIDED', exact: 2 });
  });

  it('rejects options it cannot honour', () => {
    const cases = [
      ['ERR_CONTEXT_NOT_PROVIDED', /expectDiagnostic\(\) takes an options object: \{ code, exact, min, max \}/],
      [{ exact: 1 }, /code, the ERR_\* code to expect, is required/],
      [{ code: 'ERR_CONTEXT_NOT_PROVIDED', count: 1 }, /unknown option "count"\. The options are code, exact, min, max\./],
      [{ code: 'ERR_CONTEXT_NOT_PROVIDED', exact: 1, min: 1 }, /exact cannot be combined with min or max/],
    ];
    for (const [options, message] of cases) {
      assert.throws(() => expectDiagnostic({ events: [ctx(1, 1)] }, /** @type {any} */ (options)), (err) => err instanceof TypeError && message.test(err.message));
    }
  });
});

describe('declarations', () => {
  it('accept every option shape the runtime honours and reject the ones it throws on', () => {
    const files = {
      'ok.ts': `
        import { captureDiagnostics, expectRuns, expectDiagnostic, type CapturedEffect } from 'what-framework/testing';
        const cap = captureDiagnostics(() => 1);
        const effects: CapturedEffect[] = cap.effects;
        export const owner: string[] | null = effects[0].owner;
        export const kind: 'effect' | 'computed' = effects[0].kind;
        expectRuns(cap);
        expectRuns(cap, { effect: 'sync', max: 1 });
        expectRuns(cap, { component: 'Row', exact: 2 });
        expectRuns(cap, { component: 'Row', effect: 'sync', min: 1, max: 3 });
        expectDiagnostic(cap, { code: 'ERR_X' });
        expectDiagnostic(cap, { code: 'ERR_X', exact: 2 });
      `,
      'neg-exact-and-max.ts': `
        import { captureDiagnostics, expectRuns } from 'what-framework/testing';
        expectRuns(captureDiagnostics(() => 1), { exact: 1, max: 2 });
      `,
      'neg-unknown-option.ts': `
        import { captureDiagnostics, expectRuns } from 'what-framework/testing';
        expectRuns(captureDiagnostics(() => 1), { effect: 'sync', maximum: 2 });
      `,
      'neg-code-string.ts': `
        import { captureDiagnostics, expectDiagnostic } from 'what-framework/testing';
        expectDiagnostic(captureDiagnostics(() => 1), 'ERR_X');
      `,
      'neg-code-missing.ts': `
        import { captureDiagnostics, expectDiagnostic } from 'what-framework/testing';
        expectDiagnostic(captureDiagnostics(() => 1), { exact: 1 });
      `,
    };
    const diags = tscDiagnose({
      files,
      writeRoot: dirname(fileURLToPath(import.meta.url)),
      compilerOptions: { lib: ['es2022', 'dom'] },
    });
    const byFile = new Map(Object.keys(files).map((name) => [name, []]));
    for (const d of diags) {
      const bucket = byFile.get(d.file.split(/[/\\]/).pop());
      if (!bucket) throw new Error(`diagnostic outside the fixtures: TS${d.code}: ${d.message}`);
      bucket.push(`TS${d.code}: ${d.message}`);
    }
    assert.deepEqual(byFile.get('ok.ts'), []);
    for (const [name, found] of byFile) {
      if (name.startsWith('neg-')) assert.ok(found.length > 0, `${name} must not compile`);
    }
  });
});
