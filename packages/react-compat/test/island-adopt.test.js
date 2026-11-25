// React islands hydrate by adopting the server's HTML (src/hydrate.js): where
// the browser renders what the server did, the island's elements and text
// nodes are the server's, nothing is created, and focus, typed text and
// anything else attached to those nodes stay. Where they differ, the smallest
// part that differs is rendered by the client, reported once per element as
// ERR_HYDRATION_MISMATCH, and the page ends as a client render would show it.
//
// What real React does is beside each rule, measured with react-dom 19.3.1
// (the package matrix's fixture) hydrating the same markup in jsdom
// (hydrateRoot after renderToString).
// Run: node --test packages/react-compat/test/island-adopt.test.js
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
const { createPortal } = await import('../src/dom.js');
const { ReactIsland, native, _hydrateIslands } = await import('../src/mixed.js');
const { createElement: e, useState, useEffect, useLayoutEffect, useRef, useId, useSyncExternalStore, Suspense } = React;

_hydrateIslands();

const settle = async () => { flushSync(); await new Promise((r) => setTimeout(r, 0)); flushSync(); await new Promise((r) => setTimeout(r, 0)); };

// The element and text nodes under `root`, in document order.
function nodesOf(root) {
  const out = [];
  const walker = document.createTreeWalker(root, 5);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) out.push(n);
  return out;
}

// Which side renders: components read it to render differently on each.
let side = 'server';

/**
 * Render `view` (what-react elements) as an island of a native page on the
 * server, put the HTML in the document, run `before` (the user acting on the
 * server's HTML), hydrate, and report what hydration created.
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
  const warn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  let dispose;
  try {
    dispose = hydrate(h(Page), app, { onHydrationError: (info) => records.push(info) });
    await settle();
  } finally {
    console.warn = warn;
  }
  const now = nodesOf(app);
  return {
    app, html, dispose, records, warnings, known,
    created: now.filter((n) => !known.has(n)),
    lost: serverNodes.filter((n) => !n.isConnected),
    reports: getDiagnostics().events.filter((ev) => ev.code === 'ERR_HYDRATION_MISMATCH'),
  };
}

beforeEach(() => { side = 'server'; });

test('a matching island keeps every element and text node the server wrote, and is live', async () => {
  // react-dom 19.3.1: created 0, every server node kept.
  let refEl = null;
  const log = [];
  function Counter({ label }) {
    const [n, setN] = useState(0);
    const ref = useRef(null);
    useLayoutEffect(() => { log.push('layout:' + (ref.current.tagName === 'BUTTON' && ref.current.isConnected)); }, []);
    useEffect(() => { log.push('passive'); }, []);
    return e('div', { className: 'counter', style: { marginTop: 4 } },
      e('span', { ref: (el) => { refEl = el; log.push('ref:' + (el && el.isConnected)); } }, label, ': ', n),
      e('button', { ref, onClick: () => setN(n + 1) }, 'add'),
    );
  }
  const r = await adopt(() => e(Counter, { label: 'Count' }));
  assert.match(r.html, /<span>Count<!--\$--><!--\/\$-->: <!--\$--><!--\/\$-->0<\/span>/, 'a separator between two texts, as React writes <!-- -->');
  assert.deepEqual(r.created, [], 'nothing created');
  assert.deepEqual(r.lost, [], 'nothing of the server lost');
  assert.deepEqual(r.records, []);
  assert.deepEqual(r.reports, []);
  assert.deepEqual(log, ['ref:true', 'layout:true', 'passive'], 'refs, then layout effects on the server\'s nodes, then passive effects');
  const span = r.app.querySelector('span');
  assert.equal(refEl, span, 'the ref is the server\'s element');
  assert.ok(!r.created.includes(span) && r.html.includes('<button>add</button>'));
  const texts = [...span.childNodes].filter((n) => n.nodeType === 3);
  r.app.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle();
  assert.equal(span.textContent, 'Count: 1');
  assert.equal(r.app.querySelector('span'), span);
  assert.equal([...span.childNodes].filter((n) => n.nodeType === 3)[2], texts[2], 'the server\'s text node takes the update');
  r.dispose();
});

test('the attributes the server wrote are kept as they are: none is written again', async () => {
  // react-dom 19.3.1 writes no attribute while it hydrates.
  const records = [];
  const observer = new window.MutationObserver((list) => { for (const m of list) records.push(`${m.type} ${m.target.nodeName} ${m.attributeName || ''}`); });
  let clicked = 0;
  const r = await adopt(() => e('div', { className: 'box', 'data-open': true, 'aria-hidden': false, style: { marginTop: 4, opacity: 0.5, '--x': '1' }, tabIndex: 0, title: 'a "quoted" title' },
    e('button', { type: 'button', role: 'switch', 'aria-checked': false, disabled: false, onClick: () => clicked++ }, 'toggle'),
    e('input', { type: 'checkbox', defaultChecked: true, name: 'c', readOnly: true }),
    e('select', { value: 'b', onChange: () => {} }, e('option', { value: 'a' }, 'A'), e('option', { value: 'b' }, 'B')),
    e('label', { htmlFor: 'x', hidden: true }, 'l'),
    e('svg', { viewBox: '0 0 10 10', width: 10 }, e('path', { d: 'M0 0', strokeWidth: 2, fill: 'none' })),
    e('a', { href: '/somewhere?a=1&b=2', target: '_blank', rel: 'noreferrer' }, 'link'),
  ), {
    // The island's own nodes (what-core takes data-hk off the native <main>).
    before(app) { observer.observe(app.querySelector('.box'), { attributes: true, subtree: true }); },
  });
  await settle();
  observer.disconnect();
  assert.deepEqual(r.reports, []);
  assert.deepEqual(r.created, []);
  assert.deepEqual(records, [], 'no attribute written');
  const button = r.app.querySelector('button');
  assert.equal(button.getAttribute('aria-checked'), 'false');
  assert.equal(r.app.querySelector('select').value, 'b');
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(clicked, 1);
});

test('focus and text typed into the server\'s fields before hydration stay', async () => {
  // react-dom 19.3.1: a controlled and an uncontrolled input keep the value
  // and the focus (no onChange fires for it); a checkbox keeps its state. A
  // textarea whose default is not empty gets its default back (React
  // rewrites its default); here it keeps the text.
  const changes = [];
  function Form() {
    const [name, setName] = useState('a');
    return e('form', null,
      e('input', { id: 'name', value: name, onChange: (ev) => { changes.push(ev.target.value); setName(ev.target.value); } }),
      e('input', { id: 'free', defaultValue: 'b' }),
      e('input', { id: 'box', type: 'checkbox', defaultChecked: false }),
      e('textarea', { id: 'notes', defaultValue: 'c' }),
    );
  }
  const r = await adopt(() => e(Form), {
    before(app) {
      for (const id of ['free', 'notes', 'name']) {
        const el = app.querySelector('#' + id);
        el.focus();
        el.value += 'zq';
      }
      app.querySelector('#box').checked = true;
    },
  });
  assert.deepEqual(r.created, []);
  assert.deepEqual(r.reports, []);
  const $ = (s) => r.app.querySelector(s);
  assert.equal(document.activeElement, $('#name'), 'focus stays on the server\'s field');
  assert.equal($('#name').value, 'azq');
  assert.equal($('#free').value, 'bzq');
  assert.equal($('#notes').value, 'czq');
  assert.equal($('#box').checked, true);
  assert.deepEqual(changes, [], 'no change event for what was typed before');
  // The next keystroke reports the whole text, as React does.
  $('#name').value = 'azqx';
  $('#name').dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle();
  assert.deepEqual(changes, ['azqx']);
  assert.equal($('#name').value, 'azqx');
});

test('a controlled field that renders again shows its value, as in React', async () => {
  // react-dom 19.3.1: typed "zq" into <input value="a">, then an effect
  // re-renders it with the same value: it shows "a".
  function Field() {
    const [n, setN] = useState(0);
    useEffect(() => { setN(1); }, []);
    return e('input', { id: 'f', value: 'a', 'data-n': n, onChange: () => {} });
  }
  const r = await adopt(() => e(Field), { before(app) { app.querySelector('#f').value = 'azq'; } });
  assert.equal(r.app.querySelector('#f').value, 'a');
  assert.equal(r.app.querySelector('#f').getAttribute('data-n'), '1');
  assert.deepEqual(r.created, []);
});

test('an empty text child and a <noscript> create nothing, then or when the island renders again', async () => {
  // react-dom 19.3.1: <p>a<!-- -->b</p> for ['a', '', 'b'], no node created
  // (React makes no text node for ''); a <noscript>'s content is not hydrated.
  let rerender = null;
  function Box() {
    const [n, setN] = useState(0);
    rerender = () => setN(n + 1);
    return e('div', null, e('p', null, 'a', '', 'b', n > 0 ? '' : null), e('noscript', null, e('style', null, '.x{}')), 'k' + n);
  }
  const r = await adopt(() => e(Box));
  assert.deepEqual(r.created, []);
  assert.deepEqual(r.reports, []);
  rerender();
  await settle();
  assert.deepEqual(nodesOf(r.app).filter((n) => !r.known.has(n)), [], 'still none');
  assert.deepEqual([...r.app.querySelector('p').childNodes].map((n) => n.nodeType === 3 ? n.data : '<!--' + n.data + '-->'), ['a', '<!--$-->', '<!--/$-->', 'b'], 'two texts and the separator the server wrote between them');
  assert.equal(r.app.querySelector('main div').lastChild.data, 'k1');
});

test('useId gives the ids the server wrote', async () => {
  // react-dom 19.3.1: <label for="_R_0_"><input id="_R_0_"></label>, kept.
  function Labelled({ text }) {
    const id = useId();
    return e('label', { htmlFor: id }, text, e('input', { id }));
  }
  const r = await adopt(() => e('div', null, e(Labelled, { text: 'a' }), e(Labelled, { text: 'b' })));
  const ids = [...r.app.querySelectorAll('input')].map((i) => i.id);
  assert.equal(new Set(ids).size, 2);
  assert.match(ids[0], /^_R_\w*_\d+_$/);
  assert.deepEqual([...r.app.querySelectorAll('label')].map((l) => l.htmlFor), ids);
  assert.ok(r.html.includes(`id="${ids[0]}"`) && r.html.includes(`id="${ids[1]}"`), 'the server wrote the same ids');
  assert.deepEqual(r.reports, []);
  assert.deepEqual(r.created, []);
});

test('useSyncExternalStore reads the server snapshot while it hydrates, then the client\'s', async () => {
  // react-dom 19.3.1: renders "server" (hydrating), then "client"; the <b> is kept.
  const seen = [];
  function Store() {
    const v = useSyncExternalStore(() => () => {}, () => side, () => 'server');
    seen.push(v);
    return e('b', null, v);
  }
  const r = await adopt(() => e(Store));
  assert.deepEqual(seen, ['server', 'server', 'client']);
  assert.equal(r.app.querySelector('b').textContent, 'client');
  assert.deepEqual(r.reports, []);
  assert.deepEqual(r.created, [], 'the update writes the server\'s text node');
});

test('suppressHydrationWarning keeps the server\'s text and attribute, unreported', async () => {
  // react-dom 19.3.1: <p suppressHydrationWarning>server</p> stays "server",
  // no error; an attribute that differs is never patched.
  const r = await adopt(() => e('div', null,
    e('p', { suppressHydrationWarning: true, title: side }, side),
    e('time', { suppressHydrationWarning: true }, 'at ', side)));
  assert.equal(r.app.querySelector('p').textContent, 'server');
  assert.equal(r.app.querySelector('p').title, 'server');
  assert.equal(r.app.querySelector('time').textContent, 'at server');
  assert.deepEqual(r.reports, []);
  assert.deepEqual(r.records, []);
  assert.deepEqual(r.created, []);
});

// ---- Mismatches: the client's output, reported ----

function expectReport(r, kind) {
  assert.equal(r.records.length, 1, `one record: ${JSON.stringify(r.records)}`);
  assert.equal(r.records[0].kind, kind);
  assert.equal(r.records[0].recovery, 'client-render');
  assert.equal(r.reports.length, 1);
  assert.equal(r.reports[0].data.kind, kind);
}

test('a different text: the client\'s text, in the server\'s node', async () => {
  // react-dom 19.3.1: "Hydration failed because the server rendered text
  // didn't match the client", and the whole root is rendered again (2 nodes created).
  const r = await adopt(() => e('p', null, 'a ', side));
  assert.equal(r.app.querySelector('p').textContent, 'a client');
  expectReport(r, 'text');
  assert.deepEqual(r.created, []);
  const only = await adopt(() => e('p', null, side));
  assert.equal(only.app.querySelector('p').textContent, 'client');
  expectReport(only, 'text');
});

test('a different attribute: the client\'s value', async () => {
  // react-dom 19.3.1: the server's class, title and style stay ("won't be
  // patched up", a development warning), also after a re-render that leaves
  // the prop as it was.
  const r = await adopt(() => e('div', { className: side, style: { color: side === 'server' ? 'red' : 'blue' }, id: 'x' }, 'k'));
  const div = r.app.querySelector('#x');
  assert.equal(div.className, 'client');
  assert.equal(div.style.color, 'blue');
  expectReport(r, 'attribute');
  assert.match(r.records[0].expected, /class="client"|style=/);
  assert.deepEqual(r.created, []);
  // An attribute only the server wrote goes; one only the client writes comes.
  const extra = await adopt(() => e('div', side === 'server' ? { id: 'y', title: 't' } : { id: 'y', lang: 'en' }));
  assert.equal(extra.app.querySelector('#y').hasAttribute('title'), false);
  assert.equal(extra.app.querySelector('#y').getAttribute('lang'), 'en');
  expectReport(extra, 'attribute');
});

test('an extra node: removed', async () => {
  // react-dom 19.3.1: the whole root is rendered again (3 nodes created).
  const r = await adopt(() => e('ul', null, e('li', null, 'a'), side === 'server' ? e('li', null, 'b') : null));
  assert.deepEqual([...r.app.querySelectorAll('li')].map((li) => li.textContent), ['a']);
  expectReport(r, 'extra-nodes');
  assert.deepEqual(r.created, []);
  // In the middle of a list, before the node the client renders.
  const mid = await adopt(() => e('ul', null, e('li', null, 'a'), side === 'server' ? e('b', null, 'x') : null, e('li', null, 'c')));
  assert.deepEqual([...mid.app.querySelector('ul').childNodes].map((n) => n.textContent), ['a', 'c']);
  expectReport(mid, 'extra-nodes');
  assert.deepEqual(mid.created, []);
});

test('a missing node: rendered by the client in its place', async () => {
  // react-dom 19.3.1: the whole root is rendered again (5 nodes created).
  const r = await adopt(() => e('ul', null, e('li', null, 'a'), side === 'client' ? e('li', null, 'b') : null));
  assert.deepEqual([...r.app.querySelectorAll('li')].map((li) => li.textContent), ['a', 'b']);
  expectReport(r, 'missing');
  assert.equal(r.created.length, 2, 'the <li> and its text');
});

test('a different tag: the client\'s element in place of the server\'s', async () => {
  // react-dom 19.3.1: the whole root is rendered again (4 nodes created).
  const r = await adopt(() => e('div', null, e(side === 'server' ? 'span' : 'em', null, 'a'), e('i', null, 'b')));
  const div = r.app.querySelector('main div');
  assert.equal(div.innerHTML, '<em>a</em><i>b</i>');
  expectReport(r, 'tag');
  assert.equal(r.created.length, 2, 'the <em> and its text; the <i> is the server\'s');
});

test('a portal renders in the browser; the island around it is adopted', async () => {
  // react-dom 19.3.1: portals render nothing on the server and their content
  // is created in the container while the rest hydrates.
  const target = document.createElement('section');
  const r = await adopt(() => e('div', null, 'a', createPortal(e('b', null, 'p'), target)), {
    before() { document.body.appendChild(target); },
  });
  assert.equal(target.innerHTML, '<b>p</b>');
  assert.deepEqual(r.reports, []);
  assert.deepEqual(r.created.filter((n) => r.app.contains(n)), []);
  target.remove();
});

test('a <Suspense> the server rendered is adopted; one whose fallback it wrote renders afresh', async () => {
  // react-dom 19.3.1: content inside <!--$-->…<!--/$--> is adopted; a
  // boundary the server could not finish (<!--$!-->fallback) is rendered on
  // the client, its fallback removed.
  const r = await adopt(() => e('div', null, e(Suspense, { fallback: e('i', null, 'loading') }, e('span', null, 'content'))));
  assert.match(r.html, /<!--\[\]--><span>content<\/span><!--\/\[\]-->/);
  assert.deepEqual(r.created, []);
  assert.deepEqual(r.reports, []);

  let ready = false;
  const never = new Promise(() => {});
  function Data() { if (!ready && side === 'server') throw never; return e('span', null, 'data'); }
  const f = await adopt(() => e('div', null, e(Suspense, { fallback: e('i', null, 'loading') }, e(Data))));
  assert.match(f.html, /<!--\$--><!--\[\]--><i>loading<\/i><!--\/\[\]--><!--\/\$-->/);
  assert.equal(f.app.querySelector('main div').innerHTML, '<span>data</span>');
  assert.deepEqual(f.reports, []);
});

test('a component that suspends while it hydrates leaves the server\'s HTML in place, and hydrates it once it can', async () => {
  // react-dom 19.3.1: <!--$--><span>data</span><b>after</b><!--/$--> stays as
  // it is while the client suspends (no fallback), then hydrates: no node
  // created, all five kept.
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  let ready = false;
  function Data() {
    if (side === 'client' && !ready) throw promise;
    return e('span', null, 'data');
  }
  let clicks = 0;
  let outside = 0;
  const r = await adopt(() => e('div', null,
    e(Suspense, { fallback: e('i', null, 'loading') }, e(Data), e('b', { onClick: () => clicks++ }, 'after')),
    e('em', { onClick: () => outside++ }, 'outside')));
  assert.equal(r.app.querySelector('i'), null, 'no fallback');
  assert.equal(r.app.querySelector('main div').textContent, 'dataafteroutside');
  assert.deepEqual(r.created, []);
  assert.deepEqual(r.lost, []);
  assert.deepEqual(r.reports, []);
  r.app.querySelector('em').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  r.app.querySelector('b').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(outside, 1, 'what is outside the boundary has hydrated');
  assert.equal(clicks, 0, 'the boundary has not');
  ready = true;
  resolve();
  await promise;
  await settle();
  assert.deepEqual(nodesOf(r.app).filter((n) => !r.known.has(n)), [], 'hydrated over the server\'s nodes: none created');
  assert.equal(r.app.querySelector('i'), null);
  assert.equal(r.app.querySelector('main div').textContent, 'dataafteroutside');
  r.app.querySelector('b').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(clicks, 1, 'hydrated');
  assert.deepEqual(getDiagnostics().events.filter((ev) => ev.code === 'ERR_HYDRATION_MISMATCH'), []);
});

test('a dehydrated boundary that renders again on the client first is rendered by the client', async () => {
  // React: an update to a boundary that has not hydrated yet renders it on
  // the client (its server HTML goes, its fallback shows while it waits).
  const never = new Promise(() => {});
  let setLabel = null;
  function Data() { if (side === 'client') throw never; return e('span', null, 'data'); }
  function Box() {
    const [label, set] = useState('a');
    setLabel = set;
    return e('div', null, e(Suspense, { fallback: e('i', null, 'loading ' + label) }, e(Data, { label })));
  }
  const r = await adopt(() => e(Box));
  assert.equal(r.app.querySelector('main div').innerHTML.replace(/<!--[^>]*-->/g, ''), '<span>data</span>');
  setLabel('b');
  await settle();
  assert.equal(r.app.querySelector('main div').innerHTML.replace(/<!--[^>]*-->/g, ''), '<i>loading b</i>');
});

// With a what-core that walks a range of nodes (render.js _hydrateRange, the
// change this work proposes), a native component inside an island hydrates in
// the bracket the server wrote for it; without, it is built again there.
const { adoptsNative: rangeWalk } = await import('../src/hydrate.js');

test(`a native component inside an island is ${rangeWalk ? 'adopted in' : 'built again in place of'} its bracketed HTML`, async () => {
  const count = signal(1);
  let innerClicks = 0;
  // A native component with a React island of its own inside.
  function Badge(props) {
    return h('em', { class: 'badge' }, () => props.label + count(), h(ReactIsland, { view: () => e('u', { onClick: () => innerClicks++ }, 'inner') }));
  }
  const NativeBadge = native(Badge);
  let setLabel = null;
  let setShown = null;
  function Card() {
    const [label, set] = useState('n');
    const [shown, show] = useState(true);
    setLabel = set;
    setShown = show;
    return e('div', { className: 'card' }, e('b', null, 'x'), shown ? e(NativeBadge, { label }) : null, e('i', null, 'after'));
  }
  const r = await adopt(() => e(Card));
  assert.match(r.html, /<div class="card"><b>x<\/b><!--\[\]--><em [^>]*class="badge">/);
  assert.equal(r.app.querySelector('.badge').textContent, 'n1inner');
  assert.deepEqual(r.reports, []);
  const badge = r.app.querySelector('.badge');
  r.app.querySelector('u').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(innerClicks, 1, 'the island inside it is live');
  assert.ok(!r.created.includes(r.app.querySelector('.card')) && !r.created.includes(r.app.querySelector('b')) && !r.created.includes(r.app.querySelector('i')), 'the React elements are the server\'s');
  if (rangeWalk) assert.deepEqual(r.created, [], 'the native component\'s nodes are the server\'s too');
  else assert.ok(r.created.length > 0 && r.created.every((n) => badge === n || badge.contains(n)), 'only the native component\'s nodes are new');
  count(2);
  await settle();
  assert.equal(r.app.querySelector('.badge').textContent, 'n2inner', 'its signal binding is live');
  setLabel('m');
  await settle();
  assert.equal(r.app.querySelector('.badge'), badge, 'a new prop reaches it in place');
  assert.equal(badge.textContent, 'm2inner');
  assert.equal(r.app.querySelector('.card').lastChild.textContent, 'after');
  setShown(false);
  await settle();
  assert.equal(r.app.querySelector('.badge'), null, 'its React parent removes it');
  assert.equal(r.app.querySelector('.card').textContent, 'xafter');
  setShown(true);
  await settle();
  assert.equal(r.app.querySelector('.card').textContent, 'xm2innerafter', 'and builds it again in its place');
});

test('effects run once, after hydration, and a removed island takes its adopted nodes out', async () => {
  let effects = 0;
  const show = signal(true);
  function Fx() { useEffect(() => { effects++; }, []); return e('i', null, 'fx'); }
  const view = () => e(Fx);
  const page = () => h('main', null, () => (show() ? h(ReactIsland, { view }) : null), h('p', null, 'after'));
  const r = await adopt(view, { page });
  assert.equal(effects, 1);
  assert.deepEqual(r.created, []);
  show(false);
  await settle();
  assert.equal(r.app.querySelector('i'), null);
  assert.equal(r.app.querySelector('p').textContent, 'after');
});
