// React islands hydrating where the two sides differ or something goes wrong
// (src/hydrate.js): an island that throws, ids around Suspense, children that
// differ in structure, attributes only the server wrote, enumerated
// attributes set to false, useSyncExternalStore in what mounts fresh during
// hydration, <noscript>, raw HTML, a controlled textarea, hydrateRoot's
// options.
//
// What real React does is beside each rule, measured with react-dom 19.3.0
// (the root node_modules) or 18.3.1, hydrating the same markup in jsdom
// (hydrateRoot after renderToString), unless a comment says otherwise.
// Run: node --test packages/react-compat/test/island-adopt-faults.test.js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM();
globalThis.__WHAT_DEV__ = true;

const here = path.dirname(fileURLToPath(import.meta.url));
const pk = path.resolve(here, '../..');
const server = await import(path.join(pk, 'server/src/index.js'));
const { h, signal, flushSync, getDiagnostics, clearDiagnostics } = await import(path.join(pk, 'core/src/index.js'));
const { hydrate } = await import(path.join(pk, 'core/src/render.js'));
const React = await import('../src/index.js');
const { createPortal, hydrateRoot } = await import('../src/dom.js');
const { ReactIsland, _hydrateIslands } = await import('../src/mixed.js');
const { createElement: e, useState, useEffect, useLayoutEffect, useRef, useId, useSyncExternalStore, Suspense } = React;

_hydrateIslands();

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { flushSync(); await tick(); flushSync(); await tick(); };

function nodesOf(root) {
  const out = [];
  const walker = document.createTreeWalker(root, 5);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) out.push(n);
  return out;
}

// Which side renders: components read it to render differently on each.
let side = 'server';
beforeEach(() => { side = 'server'; });

/**
 * Render `Page` (a native page with islands; by default one island of
 * `view`) on the server, put the HTML in the document, run `before`,
 * hydrate, and report what hydration created and what was reported.
 */
async function adopt(view, { before, page } = {}) {
  const Page = page || (() => h('main', null, h('h1', null, 'title'), h(ReactIsland, { view }), h('p', null, 'after')));
  side = 'server';
  const html = server.renderToHydratableString(h(Page));
  document.body.innerHTML = `<div id="app">${html}</div>`;
  const app = document.getElementById('app');
  const serverNodes = nodesOf(app);
  const known = new Set(serverNodes);
  if (before) before(app);
  side = 'client';
  clearDiagnostics();
  const records = [];
  const errors = [];
  const error = console.error;
  const warn = console.warn;
  console.error = (...a) => errors.push(a);
  console.warn = () => {};
  let dispose;
  let threw = null;
  try {
    dispose = hydrate(h(Page), app, { onHydrationError: (info) => records.push(info) });
    await settle();
  } catch (err) {
    threw = err;
  } finally {
    console.error = error;
    console.warn = warn;
  }
  const now = nodesOf(app);
  return {
    app, html, dispose, records, errors, threw, known,
    created: now.filter((n) => !known.has(n)),
    lost: serverNodes.filter((n) => !n.isConnected),
    reports: getDiagnostics().events.filter((ev) => ev.code === 'ERR_HYDRATION_MISMATCH'),
  };
}

const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

// ---- H1: one island throwing while it hydrates ----

test('an island that throws while it hydrates leaves the other islands and the native page hydrated', async () => {
  // react-dom 19.3.0: each island is a root of its own; a root whose
  // component throws on the client (no error boundary) is unmounted (its
  // container ends empty) and the error is reported; the other roots
  // hydrate and stay live.
  const text = signal('n0');
  let clicks = 0;
  function Boom() {
    if (side === 'client') throw new Error('boom');
    return e('span', { id: 'boom' }, 'fine');
  }
  const page = () => h('main', null,
    h(ReactIsland, { view: () => e('button', { id: 'good1', onClick: () => clicks++ }, 'good1') }),
    h(ReactIsland, { view: () => e(Boom) }),
    h(ReactIsland, { view: () => e('button', { id: 'good2', onClick: () => clicks++ }, 'good2') }),
    h('p', { id: 'native' }, () => text()));
  const r = await adopt(null, { page });
  assert.equal(r.threw, null, 'hydrate() does not throw');
  const good1 = r.app.querySelector('#good1');
  const good2 = r.app.querySelector('#good2');
  assert.ok(r.known.has(good1) && r.known.has(good2), 'the other islands keep the server\'s nodes');
  click(good1);
  click(good2);
  assert.equal(clicks, 2, 'the other islands are live');
  text('n1');
  await settle();
  assert.equal(r.app.querySelector('#native').textContent, 'n1', 'the native page is live');
  assert.equal(r.app.querySelector('#boom'), null, 'the island that cannot render in the browser is left empty');
  assert.equal(r.errors.length, 1, 'reported once on the console');
  assert.match(String(r.errors[0][0]), /threw while it hydrated, so it renders nothing/);
  assert.equal(r.errors[0][1].message, 'boom');
  const thrown = r.records.filter((x) => x.kind === 'error');
  assert.equal(thrown.length, 1);
  assert.equal(thrown[0].recovery, 'none');
  assert.equal(thrown[0].error.message, 'boom');
  r.dispose();
});

test('an island that throws only while it hydrates renders again in the browser; nothing of the failed render runs', async () => {
  // react-dom 19.3.0: a component that throws in the hydrating render and
  // not after: React discards the render (no ref, layout or passive effect
  // of it runs), renders the root again on the client, and reports one
  // recoverable error; refs and effects then run once, on the new nodes.
  const log = [];
  let attempts = 0;
  function Before() {
    const ref = useRef(null);
    useLayoutEffect(() => { log.push('layout:' + ref.current.isConnected); }, []);
    useEffect(() => { log.push('passive'); }, []);
    return e('b', { ref: (el) => { if (el) log.push('ref'); ref.current = el; } }, 'before');
  }
  function Flaky() {
    if (side === 'client' && attempts++ === 0) throw new Error('first render');
    return e('i', null, 'flaky');
  }
  let clicks = 0;
  const r = await adopt(() => e('div', null, e(Before), e(Flaky), e('button', { onClick: () => clicks++ }, 'go')));
  assert.equal(r.threw, null);
  assert.deepEqual(log, ['ref', 'layout:true', 'passive'], 'refs and effects run once, from the render that succeeded');
  assert.equal(r.app.querySelector('main').textContent, 'titlebeforeflakygoafter');
  click(r.app.querySelector('button'));
  assert.equal(clicks, 1, 'live');
  assert.ok(r.created.length > 0, 'the island was rendered in the browser');
  const thrown = r.records.filter((x) => x.kind === 'error');
  assert.equal(thrown.length, 1);
  assert.equal(thrown[0].recovery, 'client-render');
  assert.equal(r.errors.length, 1);
  assert.match(String(r.errors[0][0]), /it was rendered again in the browser/);
  r.dispose();
});

test('an error boundary inside the island still catches what throws while it hydrates', async () => {
  // react-dom 19.3.0: the boundary shows its fallback (React renders the
  // root again: the field beside it shows its default, "s"). Here the
  // server's nodes of what threw are a difference in structure in their
  // element, whose children the client renders again (H4): the same page.
  class Catch extends React.Component {
    constructor(p) { super(p); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error: error.message }; }
    render() { return this.state.error ? e('b', null, 'caught:' + this.state.error) : this.props.children; }
  }
  function Boom() {
    if (side === 'client') throw new Error('boom');
    return e('span', null, 'fine');
  }
  const r = await adopt(() => e('div', null, e(Catch, null, e(Boom)), e('input', { id: 'field', defaultValue: 's' })), {
    before(app) { app.querySelector('#field').value = 'typed'; },
  });
  assert.equal(r.threw, null);
  assert.equal(r.app.querySelector('b').textContent, 'caught:boom');
  assert.equal(r.app.querySelector('#field').value, 's', 'as React shows it');
  assert.equal(r.records.filter((x) => x.kind === 'error').length, 0, 'no island error: the boundary took it');
  assert.ok(r.known.has(r.app.querySelector('main div')), 'the element around them is the server\'s');
  r.dispose();
});

// ---- H2: useId around Suspense ----

const idsOf = (html) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

test('useId: a boundary whose content the server gave up on changes no id after it', async () => {
  // react-dom 19.3.0: the server writes the fallback; After's id is the
  // server's after hydration (no mismatch), and Inner, rendered in the
  // browser, gets ids of its own.
  const never = new Promise(() => {});
  function Inner() {
    const a = useId();
    if (side === 'server') throw never;
    const b = useId();
    return e('span', null, e('input', { id: a, 'data-who': 'ia' }), e('input', { id: b, 'data-who': 'ib' }));
  }
  function After() {
    const id = useId();
    return e('span', null, e('label', { htmlFor: id }, 'after'), e('input', { id, 'data-who': 'after' }));
  }
  const r = await adopt(() => e('div', null, e(Suspense, { fallback: e('i', null, 'fb') }, e(Inner)), e(After)));
  const serverFor = r.html.match(/for="([^"]+)"/)[1];
  assert.equal(r.app.querySelector('[data-who=after]').id, serverFor, 'the sibling after the boundary keeps the server\'s id');
  assert.equal(r.app.querySelector('label').getAttribute('for'), serverFor);
  assert.deepEqual(r.records, [], 'nothing differs');
  const ia = r.app.querySelector('[data-who=ia]').id;
  const ib = r.app.querySelector('[data-who=ib]').id;
  assert.ok(ia && ib && ia !== ib && ia !== serverFor && ib !== serverFor, 'the content\'s ids are its own');
  r.dispose();
});

test('useId: a component that suspends while it hydrates gets the server\'s id when it hydrates', async () => {
  // react-dom 19.3.0: before the promise settles the server's HTML stays;
  // after, Data's id and After's are the server's.
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  let ready = false;
  function Data() {
    const id = useId();
    if (side === 'client' && !ready) throw promise;
    return e('span', null, e('label', { htmlFor: id }, 'D'), e('input', { id, 'data-who': 'data' }));
  }
  function After() { return e('input', { id: useId(), 'data-who': 'after' }); }
  const r = await adopt(() => e('div', null, e(Suspense, { fallback: e('i', null, 'fb') }, e(Data)), e(After)));
  const [dataId, afterId] = idsOf(r.html);
  assert.equal(r.app.querySelector('[data-who=after]').id, afterId);
  ready = true;
  resolve();
  await promise;
  await settle();
  assert.equal(r.app.querySelector('[data-who=data]').id, dataId, 'the server\'s id, also after it hydrated');
  assert.equal(r.app.querySelector('label').getAttribute('for'), dataId);
  assert.equal(r.app.querySelector('[data-who=after]').id, afterId);
  assert.deepEqual(r.records, []);
  assert.ok(r.known.has(r.app.querySelector('[data-who=data]')), 'adopted, not built again');
  r.dispose();
});

test('useId: ids stay the server\'s in several islands, nested components, beside a portal and a <noscript>', async () => {
  // react-dom 19.3.0: every id the server wrote is the one hydration gives;
  // a portal's content and a <noscript>'s shift none of them.
  const target = document.createElement('div');
  function Field({ t }) {
    const id = useId();
    return e('span', null, e('label', { htmlFor: id }, t), e('input', { id, 'data-t': t }));
  }
  function Pair() { return e('div', null, e(Field, { t: 'a' }), e('section', null, e(Field, { t: 'b' }))); }
  function Portal() { return side === 'client' ? createPortal(e(Field, { t: 'portal' }), target) : null; }
  const page = () => h('main', null,
    h(ReactIsland, { view: () => e('div', null, e(Portal), e('noscript', null, e(Field, { t: 'ns' })), e(Pair)) }),
    h('p', null, 'between'),
    h(ReactIsland, { view: () => e(Pair) }));
  side = 'server';
  const r = await adopt(null, { page });
  const server = idsOf(r.html);
  assert.equal(new Set(server).size, server.length, 'unique on the server');
  // (jsdom parses a <noscript>'s content as elements; a browser that runs scripts reads it as text.)
  const client = [...r.app.querySelectorAll('main input[data-t]')].filter((i) => i.closest('noscript') === null).map((i) => i.id);
  assert.deepEqual(client, server.slice(-4), 'the four fields of the two islands keep the server\'s ids');
  const portalId = target.querySelector('input').id;
  assert.ok(portalId && !server.includes(portalId), 'the portal\'s field has an id of its own');
  assert.deepEqual(r.records, []);
  r.dispose();
});

test('useId: a component mounted after hydration gets an id no server id has', async () => {
  // react-dom 19.3.0 gives it a client id (_r_…_): unique in the page.
  let show;
  function Field() { return e('input', { id: useId() }); }
  function List() {
    const [more, setMore] = useState(false);
    show = () => setMore(true);
    return e('div', null, e(Field), more ? e(Field) : null);
  }
  const r = await adopt(() => e(List));
  show();
  await settle();
  const ids = [...r.app.querySelectorAll('input')].map((i) => i.id);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], idsOf(r.html)[0]);
  assert.notEqual(ids[1], ids[0]);
  r.dispose();
});

// ---- H8: useSyncExternalStore in what mounts fresh while an island hydrates ----

test('useSyncExternalStore: a portal\'s content reads the server snapshot while the island hydrates, as the claimed nodes do', async () => {
  // react-dom 19.3.0: both readers see the server snapshot in the hydrating
  // commit (the portal's: ["srv", "cli"]), then the client's.
  const target = document.createElement('div');
  const subscribe = () => () => {};
  const seen = [];
  function Reader({ who }) {
    const value = useSyncExternalStore(subscribe, () => 'cli', () => 'srv');
    useLayoutEffect(() => { seen.push(who + ':' + value); });
    return e('b', null, value);
  }
  function Uses() { return e('div', null, e(Reader, { who: 'here' }), side === 'client' ? createPortal(e(Reader, { who: 'portal' }), target) : null); }
  const r = await adopt(() => e(Uses));
  assert.deepEqual(seen.slice(0, 2), ['here:srv', 'portal:srv'], 'one snapshot in the hydrating commit');
  assert.equal(r.app.querySelector('main b').textContent, 'cli');
  assert.equal(target.textContent, 'cli', 'then the client\'s');
  r.dispose();
});

// ---- H11: <noscript> ----

test('nothing inside a <noscript> renders in the browser or runs an effect, hydrating or after', async () => {
  // react-dom 19.3.0 (shouldSetTextContent: noscript): the component in it
  // never renders on the client, in hydrateRoot or in a later render; the
  // server's content stays as it was.
  const log = [];
  function Inside() {
    log.push('render');
    useEffect(() => { log.push('effect'); }, []);
    useLayoutEffect(() => { log.push('layout'); }, []);
    return e('img', { src: '/pixel.gif' });
  }
  let rerender;
  function Page() {
    const [n, setN] = useState(0);
    rerender = () => setN((x) => x + 1);
    return e('div', null, e('noscript', null, e(Inside)), e('b', null, String(n)));
  }
  const r = await adopt(() => e(Page));
  assert.match(r.html, /<noscript><img src="\/pixel.gif"><\/noscript>/, 'the server writes it');
  assert.deepEqual(log, ['render'], 'rendered once, on the server; not in the browser, no effect');
  rerender();
  await settle();
  assert.equal(r.app.querySelector('b').textContent, '1');
  assert.deepEqual(log, ['render'], 'nor when the page renders again');
  assert.deepEqual(r.records, []);
  r.dispose();
});

test('a <noscript> mounted in the browser renders nothing of what it holds', async () => {
  // react-dom 19.3.0: createRoot().render(<noscript><Inside/></noscript>): Inside never renders.
  let renders = 0;
  function Inside() { renders++; return e('span', null, 'x'); }
  const box = document.createElement('div');
  document.body.appendChild(box);
  const { createRoot } = await import('../src/dom.js');
  const root = createRoot(box);
  root.render(e('noscript', null, e(Inside)));
  await settle();
  root.render(e('noscript', null, e(Inside), e(Inside)));
  await settle();
  assert.equal(renders, 0);
  assert.equal(box.querySelector('noscript').childNodes.length, 0);
  root.unmount();
  box.remove();
});

// ---- H4: children that differ in structure ----

test('children that differ in structure are rendered again: typed text never moves to another item', async () => {
  // react-dom 19.3.0: server [a, x, y, b], client [a, b], the user typed
  // into x and b: React renders the root again; a=a, b=b (both typed texts
  // lost, none given to another field).
  const li = (id) => e('li', null, e('input', { id, defaultValue: id }));
  const r = await adopt(() => e('ul', null, li('a'), side === 'server' ? li('x') : null, side === 'server' ? li('y') : null, li('b')), {
    before(app) { app.querySelector('#b').value = 'B-TYPED'; app.querySelector('#x').value = 'X-TYPED'; },
  });
  assert.deepEqual([...r.app.querySelectorAll('input')].map((i) => i.id + '=' + i.value), ['a=a', 'b=b']);
  assert.deepEqual(r.records.map((x) => x.kind), ['extra-nodes'], 'one report for the <ul>');
  assert.ok(r.known.has(r.app.querySelector('ul')), 'the <ul> is the server\'s');
  r.dispose();
});

test('a difference in structure renders only that element\'s children again; text and attributes are mended in place', async () => {
  // react-dom 19.3.0 renders the whole root again in each case. Here: the
  // <section> beside the <ul> keeps its server nodes (and typed text), a
  // text that differs is mended in its node.
  const r = await adopt(() => e('div', null,
    e('ul', null, e('li', null, 'a'), side === 'client' ? e('li', null, 'new') : null),
    e('section', null, e('input', { id: 'kept', defaultValue: 'k' }), e('p', { title: side }, side === 'server' ? 'old' : 'new'))), {
    before(app) { app.querySelector('#kept').value = 'typed'; },
  });
  assert.equal(r.app.querySelector('#kept').value, 'typed');
  assert.ok(r.known.has(r.app.querySelector('#kept')));
  const p = r.app.querySelector('section p');
  assert.ok(r.known.has(p) && r.known.has(p.firstChild), 'the text is mended in the server\'s node');
  assert.equal(p.textContent, 'new');
  assert.equal(p.title, 'client');
  assert.deepEqual([...r.app.querySelectorAll('li')].map((x) => x.textContent), ['a', 'new']);
  assert.deepEqual(r.records.map((x) => x.kind).sort(), ['attribute', 'missing', 'text']);
  r.dispose();
});

test('a difference at the top of an island renders the island again; its ids are the ones the server gave', async () => {
  // react-dom 19.3.0: the root is rendered again.
  let clicks = 0;
  function Field() { const id = useId(); return e('label', { htmlFor: id }, e('input', { id })); }
  const r = await adopt(() => [side === 'server' ? e('i', { key: 'i' }, 'srv') : e('b', { key: 'b' }, 'cli'), e(Field, { key: 'f' }), e('button', { key: 'go', onClick: () => clicks++ }, 'go')]);
  assert.equal(r.app.querySelector('main').innerHTML.replace(/<!--[^>]*-->/g, ''), `<h1>title</h1><b>cli</b><label for="${r.app.querySelector('input').id}"><input id="${r.app.querySelector('input').id}"></label><button>go</button><p>after</p>`);
  assert.equal(r.app.querySelector('input').id, r.html.match(/ id="([^"]+)"/)[1], 'the server\'s id: the first render\'s were given again');
  click(r.app.querySelector('button'));
  assert.equal(clicks, 1);
  assert.deepEqual(r.records.map((x) => x.kind), ['tag']);
  r.dispose();
});

test('a difference in a <Suspense>\'s content renders that content again, between its markers', async () => {
  // react-dom 19.3.0: the boundary is rendered again on the client.
  function Content() { return e('ul', null, side === 'server' ? e('li', null, 'srv') : null, e('li', null, 'both')); }
  const r = await adopt(() => e('div', null, e(Suspense, { fallback: e('i', null, 'fb') }, e('em', null, 'x'), side === 'server' ? e('s', null, 'gone') : null, e(Content)), e('input', { id: 'after', defaultValue: 'a' })), {
    before(app) { app.querySelector('#after').value = 'typed'; },
  });
  assert.equal(r.app.querySelector('div').textContent, 'xboth');
  assert.equal(r.app.querySelector('#after').value, 'typed', 'what is after the boundary is the server\'s');
  assert.ok(r.known.has(r.app.querySelector('#after')));
  r.dispose();
});

// ---- H12 ----

test('a mismatch is reported once per element, not once per region', async () => {
  // react-dom 19.3.0 lists each differing element in its development
  // warning. Here: one record for each <li> whose attribute differs.
  const r = await adopt(() => e('ul', null, ['a', 'b', 'c'].map((t) => e('li', { key: t, title: side + t }, t))));
  assert.deepEqual(r.records.map((x) => x.kind + '@' + x.path), ['attribute@div>main>ul>li', 'attribute@div>main>ul>li[1]', 'attribute@div>main>ul>li[2]']);
  assert.equal(r.reports.length, 3);
  assert.deepEqual([...r.app.querySelectorAll('li')].map((li) => li.title), ['clienta', 'clientb', 'clientc']);
  r.dispose();
});

test('raw HTML that differs keeps the server\'s and is reported in development', async () => {
  // react-dom 19.3.0 (development): keeps <b>srv</b> and warns ("some
  // attributes of the server rendered HTML didn't match"); production: silent.
  const r = await adopt(() => e('div', { id: 'd', dangerouslySetInnerHTML: { __html: side === 'server' ? '<b>srv</b>' : '<b>cli</b>' } }));
  assert.equal(r.app.querySelector('#d').innerHTML, '<b>srv</b>');
  assert.deepEqual(r.records.map((x) => [x.kind, x.recovery]), [['attribute', 'none']]);
  assert.match(r.records[0].expected, /cli/);
  const same = await adopt(() => e('div', { id: 'd', dangerouslySetInnerHTML: { __html: '<br/>same' } }));
  assert.deepEqual(same.records, [], 'the same HTML as the browser reads it is no mismatch');
  r.dispose();
  same.dispose();
});

test('a controlled textarea shows its value after hydration; an uncontrolled one keeps what the user typed', async () => {
  // react-dom 19.3.0, the user typed "Z" in each before hydration: value
  // "ctl" shows "ctl" (as here); defaultValue "dflt" shows "dflt" (here
  // "Z": the user's text is kept, a deliberate difference).
  const r = await adopt(() => e('div', null,
    e('textarea', { id: 'ctl', value: 'ctl', onChange: () => {} }),
    e('textarea', { id: 'dflt', defaultValue: 'dflt' })), {
    before(app) { for (const t of app.querySelectorAll('textarea')) t.value = 'Z'; },
  });
  assert.equal(r.app.querySelector('#ctl').value, 'ctl');
  assert.equal(r.app.querySelector('#dflt').value, 'Z');
  assert.ok(r.known.has(r.app.querySelector('#ctl')));
  assert.deepEqual(r.records, []);
  r.dispose();
});

test('hydrateRoot (full compat) honours identifierPrefix and onRecoverableError', async () => {
  // react-dom 19.3.0: createRoot/hydrateRoot with identifierPrefix "app-"
  // gives client ids "_app-r_<n>_"; a tree it renders again (the server's
  // HTML did not match) calls onRecoverableError once with "Hydration
  // failed because the server rendered HTML didn't match the client. ...".
  function F() { return e('input', { id: useId() }); }
  const box = document.createElement('div');
  box.innerHTML = '<div><input id="_app-R_1_"/></div>';
  document.body.appendChild(box);
  const errors = [];
  const root = hydrateRoot(box, e('div', null, e(F), e('b', null, 'x')), { identifierPrefix: 'app-', onRecoverableError: (er) => errors.push(er.message) });
  assert.match(box.querySelector('input').id, /^_app-r_[0-9a-v]+_$/);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^Hydration failed because the server rendered HTML didn't match the client/);
  root.unmount();
  box.innerHTML = '<p>same<!-- --></p>';
  const quiet = hydrateRoot(box, e('p', null, 'same'), { onRecoverableError: (er) => errors.push(er.message) });
  assert.equal(errors.length, 1, 'not called when the client renders the server\'s HTML');
  quiet.unmount();
  box.remove();
});

// ---- H5, H6: attributes only the server has; enumerated attributes set to false ----

test('an attribute only the server wrote (an extension\'s) is kept and reported', async () => {
  // react-dom 19.3.0: data-gramm, data-lpignore and an autocomplete a
  // password manager added before hydration stay (a development warning).
  const r = await adopt(() => e('form', null, e('input', { id: 'pw', type: 'password' }), e('textarea', { id: 'ta' })), {
    before(app) {
      app.querySelector('#pw').setAttribute('autocomplete', 'current-password');
      app.querySelector('#ta').setAttribute('data-gramm', 'false');
      app.querySelector('#ta').setAttribute('data-lpignore', 'true');
    },
  });
  assert.equal(r.app.querySelector('#pw').getAttribute('autocomplete'), 'current-password');
  assert.equal(r.app.querySelector('#ta').getAttribute('data-gramm'), 'false');
  assert.equal(r.app.querySelector('#ta').getAttribute('data-lpignore'), 'true');
  const kept = r.records.filter((x) => x.kind === 'attribute');
  assert.equal(kept.length, 2, 'one report per element');
  assert.ok(kept.every((x) => x.recovery === 'none'));
  r.dispose();
});

test('draggable, spellCheck and contentEditable set to false apply on the server and after hydration', async () => {
  // react-dom 19.3.0: the server writes draggable="false",
  // spellCheck="false", contentEditable="false"; after hydration the image
  // and the link are not draggable.
  const r = await adopt(() => e('div', null,
    e('img', { id: 'im', src: '/x.png', draggable: false }),
    e('div', { id: 'sp', spellCheck: false, contentEditable: false, suppressContentEditableWarning: true }, 't'),
    e('a', { id: 'lk', href: '/x', draggable: false }, 'l')));
  assert.match(r.html, /<img id="im" src="\/x.png" draggable="false">/);
  assert.match(r.html, /spellCheck="false" contentEditable="false"/);
  assert.equal(r.app.querySelector('#im').draggable, false);
  assert.equal(r.app.querySelector('#lk').draggable, false);
  assert.equal(r.app.querySelector('#sp').getAttribute('spellcheck'), 'false');
  assert.equal(r.app.querySelector('#sp').getAttribute('contenteditable'), 'false');
  assert.deepEqual(r.records, []);
  r.dispose();
});

test('an enumerated attribute that differs takes the client\'s text', async () => {
  // React keeps the server's here (and warns); what-react writes the
  // client's, as for every attribute: spellcheck="false", not removed.
  const r = await adopt(() => e('div', { id: 'sp', spellCheck: side === 'client' ? false : true }, 't'));
  assert.equal(r.app.querySelector('#sp').getAttribute('spellcheck'), 'false');
  assert.deepEqual(r.records.map((x) => x.kind), ['attribute']);
  r.dispose();
});

// ---- H3: a form submitted before hydration ----

// The page's inline capture script, run as the browser runs it while it parses.
function runScripts(app) {
  for (const script of app.querySelectorAll('script')) {
    new Function('addEventListener', 'document', 'FormData', script.textContent)(window.addEventListener.bind(window), document, window.FormData);
  }
}

test('a form submitted before its island hydrates does not navigate, and its action runs once it has hydrated', async () => {
  // react-dom 19.3.0: the server writes action="javascript:throw new
  // Error('React form unexpectedly submitted.')" and a capture script; a
  // submit before hydrateRoot is prevented and kept; after hydration the
  // action runs once with the data typed and the submitter's value
  // (useActionState: 10 -> 11), and the form is reset.
  const log = [];
  function Form() {
    const [state, act, pending] = React.useActionState((prev, data) => { log.push('action:' + data.get('q') + ':' + data.get('btn')); return prev + 1; }, 10);
    return e('form', { action: act }, e('input', { name: 'q', defaultValue: 'v' }), e('button', { name: 'btn', value: 'go' }, 'go'), e('output', null, `state=${state} pending=${pending}`));
  }
  let submit = null;
  delete document.$$whatForms;
  const r = await adopt(() => e(Form), {
    before(app) {
      runScripts(app);
      app.querySelector('input').value = 'typed';
      const form = app.querySelector('form');
      submit = new window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: app.querySelector('button') });
      form.dispatchEvent(submit);
    },
  });
  assert.match(r.html, /<form action="javascript:throw new Error\(&#39;React form unexpectedly submitted\.&#39;\)">/);
  assert.match(r.html, /<script>/, 'the capture script, inside the form');
  assert.equal(submit.defaultPrevented, true, 'no navigation with the fields in the URL');
  await settle();
  assert.deepEqual(log, ['action:typed:go'], 'run once, with what was submitted');
  assert.equal(r.app.querySelector('output').textContent, 'state=11 pending=false');
  assert.equal(r.app.querySelector('input').value, 'v', 'reset after the action, as React resets it');
  assert.deepEqual(document.$$whatForms, []);
  assert.deepEqual(r.records, [], 'the script is no mismatch: a form keeps what the client does not render');
  // After hydration a submit runs the action as always, and is not kept.
  r.app.querySelector('form').dispatchEvent(new window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: r.app.querySelector('button') }));
  await settle();
  assert.deepEqual(log, ['action:typed:go', 'action:v:go']);
  assert.deepEqual(document.$$whatForms, []);
  r.dispose();
});

test('a submit button\'s function formAction is guarded the same way', async () => {
  // react-dom 19.3.0 writes formAction="javascript:throw …" on the button.
  const log = [];
  function Form() {
    return e('form', { action: '/fallback' }, e('input', { name: 'q', defaultValue: 'x' }), e('button', { formAction: (data) => { log.push(data.get('q')); } }, 'go'));
  }
  delete document.$$whatForms;
  let submit = null;
  const r = await adopt(() => e(Form), {
    before(app) {
      runScripts(app);
      submit = new window.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: app.querySelector('button') });
      app.querySelector('form').dispatchEvent(submit);
    },
  });
  assert.match(r.html, /<button formAction="javascript:throw/);
  assert.equal(submit.defaultPrevented, true);
  await settle();
  assert.deepEqual(log, ['x']);
  assert.equal(r.app.querySelector('form').getAttribute('action'), '/fallback');
  r.dispose();
});

// ---- H10: refs and layout effects, child first, while an island hydrates ----

test('hydration attaches refs and runs layout effects in one pass, children first, as React', async () => {
  // react-dom 19.3.0 and 18.3.1, hydrateRoot: "C:ins > P:ins > C:ref >
  // C:layout > K:ref > K:didMount > P:ref > P:layout > C:passive > P:passive".
  const log = [];
  class Klass extends React.Component {
    componentDidMount() { log.push('K:didMount'); }
    render() { return e('u', { ref: (el) => { if (el) log.push('K:ref'); } }, 'k'); }
  }
  function Child() {
    React.useInsertionEffect(() => { if (side === 'client') log.push('C:ins'); }, []);
    useLayoutEffect(() => { log.push('C:layout'); }, []);
    useEffect(() => { log.push('C:passive'); }, []);
    return e('span', { ref: (el) => { if (el) log.push('C:ref'); } }, 'c');
  }
  function Parent() {
    React.useInsertionEffect(() => { if (side === 'client') log.push('P:ins'); }, []);
    useLayoutEffect(() => { log.push('P:layout'); }, []);
    useEffect(() => { log.push('P:passive'); }, []);
    return e('div', { ref: (el) => { if (el) log.push('P:ref'); } }, e(Child), e(Klass));
  }
  const r = await adopt(() => e(Parent));
  assert.equal(log.join(' > '), 'C:ins > P:ins > C:ref > C:layout > K:ref > K:didMount > P:ref > P:layout > C:passive > P:passive');
  assert.deepEqual(r.created, []);
  r.dispose();
});
