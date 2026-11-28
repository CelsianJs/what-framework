// renderToStream under concurrency.
//
// The streaming renderer used to keep a component's frame on what-core's
// process-wide component stack while it streamed the frame's subtree, across
// every `await`. A second request streaming at the same time pushed its own
// frames in between, so a component in request A resolved useContext() against
// request B's <Provider>: one user's page rendered another user's data (R1).
// Frames that interleaved were never popped, so the stack grew by one request's
// worth of frames per round and every later render in the process, string
// renders included, parented its components under a dead request (R1b).
//
// It also rendered a boundary's subtree with the synchronous renderToString, so
// a <Suspense> nested inside an <ErrorBoundary> or another <Suspense> shipped
// its fallback as final HTML (R3), and it yielded one chunk per tag.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  h,
  createContext,
  useContext,
  useEffect,
  Suspense,
  ErrorBoundary,
  createResource,
  getOwner,
} from 'what-core';
import { renderToHydratableString, renderToStream, renderToString, renderToStringAsync } from '../src/index.js';
import { collect, content, keyShape, settle } from './stream-helpers.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const UserCtx = createContext('nobody');
const Greeting = () => h('p', null, 'hello ', useContext(UserCtx));

describe('renderToStream never shares component frames between requests', () => {
  it('two concurrent streams each render their own context value (R1)', async () => {
    const Page = ({ user }) => h(UserCtx.Provider, { value: user },
      h('div', null, h('h1', null, 'profile'), h(Greeting, {}), h(Greeting, {})));

    const [a, b] = await Promise.all([
      collect(renderToStream(h(Page, { user: 'alice' }))),
      collect(renderToStream(h(Page, { user: 'bob' }))),
    ]);
    assert.equal(content(a), '<div><h1>profile</h1><p>hello alice</p><p>hello alice</p></div>');
    assert.equal(content(b), '<div><h1>profile</h1><p>hello bob</p><p>hello bob</p></div>');
  });

  it('many interleaved streams with async components and resources never cross-talk', async () => {
    const STREAMS = 40;
    async function Pause({ ms, children }) {
      await delay(ms);
      return children;
    }
    function Loaded({ user, ms }) {
      const [value] = createResource(() => delay(ms).then(() => user), { key: 'user' });
      return h('span', null, () => value(), ':', useContext(UserCtx));
    }
    const Page = ({ user, seed }) => h(UserCtx.Provider, { value: user },
      h('main', null,
        h(Greeting, {}),
        h(Pause, { ms: seed % 7 }, h('section', null, h(Greeting, {}))),
        h(Suspense, { fallback: h('i', null, 'loading') },
          h(Pause, { ms: (seed * 3) % 5 }, h(Loaded, { user, ms: seed % 4 }), h(Greeting, {}))),
        h(Greeting, {}),
      ));

    const users = Array.from({ length: STREAMS }, (_, i) => `user${i}`);
    const pages = await Promise.all(users.map((user, i) => collect(renderToStream(h(Page, { user, seed: i })))));

    pages.forEach((html, i) => {
      const user = users[i];
      const final = content(settle(html));
      assert.equal((final.match(/hello user\d+/g) || []).length, 4, `stream ${i}: ${final}`);
      for (const match of final.match(/user\d+/g)) {
        assert.equal(match, user, `stream ${i} rendered another request's value: ${final}`);
      }
      assert.match(final, new RegExp(`<span>${user}:${user}</span>`));
      assert.doesNotMatch(final, /nobody|loading/);
    });
  });

  it('leaves no frames on the shared stack, so later renders are not poisoned (R1b)', async () => {
    const Page = ({ user }) => h(UserCtx.Provider, { value: user },
      h('div', null, h('h1', null, 'x'), h(Greeting, {})));
    for (let round = 1; round <= 3; round++) {
      await Promise.all(['alice', 'bob', 'carol'].map((u) => collect(renderToStream(h(Page, { user: u + round })))));
      assert.equal(getOwner(), null, `a component frame was left current after round ${round}`);
    }
    assert.equal(renderToString(h(Greeting, {})), '<p>hello nobody</p>');
  });

  it('runs no effect on the server even when the stream waits mid-render', async () => {
    let ran = 0;
    function WithEffect() {
      useEffect(() => { ran++; });
      useEffect(() => { ran++; }, []);
      return h('p', null, 'x');
    }
    async function Later() {
      await delay(5);
      return h('p', null, 'later');
    }
    await collect(renderToStream(h('div', null, h(WithEffect, {}), h(Later, {}))));
    await delay(5);
    assert.equal(ran, 0);
  });
});

describe('renderToStream resolves nested boundaries (R3)', () => {
  function Data() {
    const [d] = createResource(() => delay(5).then(() => 'DATA'), { key: 'd' });
    return h('b', null, () => d());
  }
  const susp = (child) => h(Suspense, { fallback: h('i', null, 'loading') }, child);
  const cases = {
    'Suspense alone': () => susp(h(Data, {})),
    'ErrorBoundary > Suspense': () => h(ErrorBoundary, { fallback: h('i', null, 'error') }, susp(h(Data, {}))),
    'Suspense > Suspense': () => susp(h('div', null, susp(h(Data, {})))),
    'Suspense > ErrorBoundary > Suspense': () => susp(h(ErrorBoundary, { fallback: h('i', null, 'error') }, susp(h(Data, {})))),
  };
  for (const [name, make] of Object.entries(cases)) {
    it(`${name} streams the data, as renderToStringAsync does`, async () => {
      const streamed = settle(await collect(renderToStream(h('main', null, make()))));
      const { body } = await renderToStringAsync(h('main', null, make()));
      assert.equal(streamed, body);
      assert.match(content(streamed), /<b>DATA<\/b>/);
    });
  }
});

describe('renderToStream sends chunks, not tags', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, label: `row ${i + 1}` }));
  function Table() {
    return h('table', { class: 'table' }, h('tbody', null, () => rows.map((row) => h('tr', { key: row.id },
      h('td', { class: 'col-md-1' }, row.id),
      h('td', { class: 'col-md-4' }, h('a', { class: 'lbl' }, row.label)),
      h('td', { class: 'col-md-6' })))));
  }

  it('streams a 1,000-row table in a few chunks with the same bytes as renderToHydratableString', async () => {
    const chunks = [];
    for await (const chunk of renderToStream(h(Table, {}))) chunks.push(chunk);
    const html = chunks.join('');
    assert.equal(keyShape(html), keyShape(renderToHydratableString(h(Table, {}))));
    assert.equal(content(html), renderToString(h(Table, {})));
    assert.ok(chunks.length <= Math.ceil(html.length / 65536) + 1, `${chunks.length} chunks for ${html.length} bytes`);
  });

  it('closes the elements a failed component opened, so the page stays balanced', async () => {
    const Broken = () => h('section', null, h('div', null, h('p', null, 'before'), h('bad tag', null)));
    const original = console.error;
    console.error = () => {};
    let html;
    try {
      html = await collect(renderToStream(h('main', null, h(Broken, {}), h('footer', null, 'after'))));
    } finally {
      console.error = original;
    }
    assert.match(content(html), /^<main><section><div><p>before<\/p><\/div><\/section><!-- SSR Error[^>]*--><footer>after<\/footer><\/main>$/);
  });
});
