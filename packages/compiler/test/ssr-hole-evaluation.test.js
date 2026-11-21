// When the server target evaluates what. A compiled element is evaluated where
// its JSX expression runs, as the h() call it stands for is: a plain hole is
// read then, a reactive hole (what h() is handed as a thunk) is rendered at its
// place in the document, with h()'s rules for a throw and for a suspension.
// Each case renders the compiled tree and its h() spelling in every renderer
// and expects the same output, and the same order of side effects.
//
// lowering-parity-fuzz.test.js checks the same property on random trees; these
// are the cases the review found, kept as they were written.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { content, stableIds } from '../../server/test/stream-helpers.js';

const { renderToString, renderToHydratableString, renderToStream, renderToStringAsync, renderDocument } = await import('../../server/src/index.js');
const { h, ErrorBoundary, Suspense } = await import('what-framework');

const load = (source) => loadCompiled(source, { pluginOptions: { generate: 'ssr' } });

async function streamed(tree) {
  let html = '';
  for await (const chunk of renderToStream(tree, { onError: () => {} })) html += chunk;
  return stableIds(html);
}

const RENDERERS = {
  string: (tree) => renderToString(tree),
  hydratable: (tree) => renderToHydratableString(tree),
  stream: streamed,
  async: async (tree) => (await renderToStringAsync(tree, undefined, { onError: () => {} })).body,
  document: (tree) => renderDocument({ default: () => tree }, {}, { onError: () => {} }),
};

const quiet = async (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

// Every renderer, each with a fresh tree from `make` and a fresh log.
async function renderAll(make, log) {
  const out = {};
  for (const [name, render] of Object.entries(RENDERERS)) {
    log.length = 0;
    let html;
    try {
      html = await quiet(() => render(make()));
    } catch (e) {
      html = `THREW ${e.message}`;
    }
    out[name] = { html, order: log.join('>') };
  }
  return out;
}

const log = [];
globalThis.__holeLog = log;
const mod = await load(`
  import { ErrorBoundary, Suspense } from 'what-framework';
  const log = globalThis.__holeLog;
  export const page = (bad) => <main><h1>Title</h1><p title={bad()}>{bad()}</p><footer>end</footer></main>;
  export const guarded = (bad) => <div><ErrorBoundary fallback={<i>fallback</i>}><b>{bad()}</b></ErrorBoundary></div>;
  export function loopVar() { const out = []; for (var i = 0; i < 3; i++) out.push(<li>{i}</li>); return <ul>{out}</ul>; }
  export function reassigned() { let label = 'first'; const el = <b>{label}</b>; label = 'second'; return el; }
  function fail(n) { throw new Error('fail ' + n); }
  export function tryCatch() { let el; try { el = <p>{fail(1)}</p>; } catch (e) { el = <p>caught</p>; } return el; }
  function Register() { log.push('Register'); return <i>r</i>; }
  export const order = (read) => <div><Register /><span>{log.join(',') || 'empty'}|{read()}</span></div>;
  export const retry = (count, data) => <Suspense fallback={<i>loading</i>}><p>{count()}|{data()}</p></Suspense>;
`);

const bad = () => { throw new Error('row data missing'); };

describe('server target: a throwing hole renders as it does in h()', () => {
  it('a reactive child or attribute that throws renders an empty region in every renderer', async () => {
    const compiled = await renderAll(() => mod.page(bad), log);
    const expected = await renderAll(() => h('main', null, h('h1', null, 'Title'), h('p', { title: () => bad() }, () => bad()), h('footer', null, 'end')), log);
    assert.deepEqual(compiled, expected);
    assert.equal(compiled.string.html, '<main><h1>Title</h1><p></p><footer>end</footer></main>');
    assert.match(content(compiled.document.html), /<body><main><h1>Title<\/h1><p><\/p><footer>end<\/footer><\/main>/);
  });

  it('inside an <ErrorBoundary>, every renderer renders the same thing', async () => {
    const compiled = await renderAll(() => mod.guarded(bad), log);
    const expected = await renderAll(() => h('div', null, h(ErrorBoundary, { fallback: h('i', null, 'fallback') }, h('b', null, () => bad()))), log);
    assert.deepEqual(compiled, expected);
    const plain = new Set(['string', 'stream', 'async'].map((name) => content(compiled[name].html)));
    assert.equal(plain.size, 1, 'the renderers disagree');
  });
});

describe('server target: plain holes are read when the JSX expression runs', () => {
  it('JSX built in a loop keeps each iteration\'s value', async () => {
    const compiled = await renderAll(() => mod.loopVar(), log);
    for (const { html } of Object.values(compiled)) assert.match(content(html), /<ul><li>0<\/li><li>1<\/li><li>2<\/li>/);
  });

  it('a variable written again after the JSX does not change it', async () => {
    for (const { html } of Object.values(await renderAll(() => mod.reassigned(), log))) assert.match(content(html), /<b>first<\/b>/);
  });

  it('JSX built in a try/catch throws inside it', async () => {
    for (const { html } of Object.values(await renderAll(() => mod.tryCatch(), log))) assert.match(content(html), /<p>caught<\/p>/);
  });
});

describe('server target: side effects run in h()\'s order in every renderer', () => {
  it('a plain hole runs before the component written ahead of it renders; a reactive one after', async () => {
    const read = () => { log.push('read'); return log.filter((e) => e === 'Register').length; };
    function Register() { log.push('Register'); return h('i', null, 'r'); }
    const compiled = await renderAll(() => mod.order(read), log);
    const expected = await renderAll(() => h('div', null, h(Register), h('span', null, log.join(',') || 'empty', '|', () => read())), log);
    assert.deepEqual(compiled, expected);
    for (const { html, order } of Object.values(compiled)) {
      assert.match(content(html), /<span>empty\|1<\/span>/);
      assert.equal(order, 'Register>read');
    }
  });

  it('a suspending hole is retried on its own: the other holes of its template run once', async () => {
    const makeData = () => {
      let done = false;
      let pending = null;
      return () => {
        if (done) return 'data';
        pending ??= new Promise((resolve) => setTimeout(() => { done = true; resolve(); }, 5));
        throw pending;
      };
    };
    let calls = 0;
    const count = () => ++calls;
    for (const name of ['stream', 'async']) {
      calls = 0;
      const compiled = await RENDERERS[name](mod.retry(count, makeData()));
      const compiledCalls = calls;
      calls = 0;
      const data = makeData();
      const expected = await RENDERERS[name](h(Suspense, { fallback: h('i', null, 'loading') }, h('p', null, () => count(), '|', () => data())));
      assert.equal(compiled, expected, name);
      assert.equal(compiledCalls, calls, `${name}: count() ran ${compiledCalls} times, h() ${calls}`);
      assert.match(content(compiled), /<p>1\|data<\/p>/);
    }
  });
});
