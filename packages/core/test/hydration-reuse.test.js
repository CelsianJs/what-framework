// Markup the parser reads in its own way, and lists, hydrate with no false
// report and keep every node the server wrote:
//
//   - <textarea> and <title> hold text only (a comment there is text), so
//     both server targets write their children with no markers, and both
//     clients hydrate that text as one text node;
//   - the parser drops a newline right after <pre>, <textarea> and <listing>,
//     so both server targets write one there;
//   - a compiled <For fallback> adopts its rows (or its fallback), and a
//     keyed row of several nodes starts at the array marker the server
//     bracketed it with.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { h, hydrate, mount, flushSync, signal } = await import('../src/index.js');
const server = await import('../../server/src/index.js');

function nodesOf(root) {
  const out = [];
  const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_ALL);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) out.push(n);
  return out;
}

// Hydrate `html` with `tree`, and report what the walk added and reported.
function adopt(html, tree) {
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = html;
  const before = nodesOf(host);
  const reports = [];
  const stop = hydrate(tree, host, { onHydrationError: (r) => reports.push([r.kind, r.path]) });
  const added = nodesOf(host).filter((n) => !before.includes(n)).map((n) => (n.nodeType === 8 ? `<!--${n.data}-->` : n.nodeName));
  return { host, reports, added, stop };
}

const textSource = `import { signal } from 'what-framework';
  export function make() {
    const value = signal('abc');
    function Page() { return <main><pre>{'\\nabc'}</pre><textarea>{value()}</textarea><title>{value()}</title></main>; }
    return { Page, value };
  }`;
const textClient = await loadCompiled(textSource, { pluginOptions: { hydratable: true } });
const textServer = await loadCompiled(textSource, { pluginOptions: { generate: 'ssr' } });

function hText() {
  const value = signal('abc');
  return { value, Page: () => h('main', null, h('pre', null, '\nabc'), h('textarea', null, value), h('title', null, value)) };
}

describe('text-only elements and the leading newline', () => {
  for (const [label, serverMake, clientMake] of [['h()', hText, hText], ['compiled', textServer.make, textClient.make]]) {
    it(`${label}: the server writes no markers in <textarea> or <title>, and a newline after <pre>`, () => {
      for (const render of [server.renderToHydratableString, server.renderToString]) {
        const html = render(h(serverMake().Page));
        assert.match(html, /<pre>\n\nabc<\/pre>/, html);
        assert.match(html, /<textarea>\nabc<\/textarea><title>abc<\/title>/, html);
      }
    });

    it(`${label}: the client adopts them with no report, no node and a live binding`, () => {
      const app = clientMake();
      const { host, reports, added, stop } = adopt(server.renderToHydratableString(h(serverMake().Page)), h(app.Page));
      const textarea = host.querySelector('textarea');
      assert.equal(textarea.value, 'abc');
      assert.equal(host.querySelector('pre').textContent, '\nabc');
      assert.deepEqual(reports, []);
      assert.deepEqual(added, []);
      app.value('xyz');
      flushSync();
      assert.equal(textarea.value, 'xyz');
      assert.equal(host.querySelector('title').textContent, 'xyz');
      stop();
    });
  }

  it('the stream writes the same', async () => {
    let html = '';
    for await (const chunk of server.renderToStream(h(hText().Page))) html += Buffer.from(chunk).toString();
    assert.match(html, /<pre>\n\nabc<\/pre><textarea>\nabc<\/textarea><title>abc<\/title>/, html);
  });

  it('a <title> inside <svg> is not text-only', () => {
    const html = server.renderToHydratableString(h('svg', null, h('title', null, () => 'tip')));
    assert.match(html, /<title><!--\$-->tip<!--\/\$--><\/title>/, html);
  });
});

const listSource = `import { For, signal } from 'what-framework';
  export function make(initial) {
    const rows = signal(initial);
    function Page() { return <main><For each={rows} fallback={<i>empty</i>}>{(id) => <b>{id}</b>}</For><p>tail</p></main>; }
    return { Page, rows };
  }
  export function makeRows() {
    const rows = signal(['a', 'b']);
    function Row({ id }) { return <><b>{id}</b><i>{id}</i></>; }
    function Page() { return <main>{() => rows().map((id) => <Row key={id} id={id} />)}</main>; }
    return { Page, rows };
  }`;
const listClient = await loadCompiled(listSource, { pluginOptions: { hydratable: true } });
const listServer = await loadCompiled(listSource, { pluginOptions: { generate: 'ssr' } });

describe('compiled lists keep the server\'s nodes', () => {
  for (const initial of [['a', 'b'], []]) {
    it(`<For fallback> with ${initial.length ? 'rows' : 'no rows'}: every element and text is the server's, and it stays live`, () => {
      const app = listClient.make(initial);
      const { host, reports, added, stop } = adopt(server.renderToHydratableString(h(listServer.make(initial).Page)), h(app.Page));
      assert.deepEqual(reports, []);
      assert.deepEqual(added.filter((n) => !n.startsWith('<!--')), []);
      assert.equal(host.textContent, initial.length ? 'abtail' : 'emptytail');
      app.rows(initial.length ? [] : ['x']);
      flushSync();
      assert.equal(host.textContent, initial.length ? 'emptytail' : 'xtail');
      app.rows(['c', 'd']);
      flushSync();
      assert.equal(host.textContent, 'cdtail');
      stop();
    });
  }

  it('a keyed row of several nodes starts at the server\'s array marker and moves whole', () => {
    const app = listClient.makeRows();
    const { host, reports, added, stop } = adopt(server.renderToHydratableString(h(listServer.makeRows().Page)), h(app.Page));
    assert.deepEqual(reports, []);
    assert.deepEqual(added, []);
    const [b0, , b1] = host.querySelectorAll('b, i');
    app.rows(['b', 'a']);
    flushSync();
    assert.equal(host.querySelector('main').textContent, 'bbaa');
    assert.equal(host.querySelectorAll('b')[0], b1);
    assert.equal(host.querySelectorAll('b')[1], b0);
    stop();
  });

  it('a fresh mount of the same list renders the same', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const stop = mount(h(listClient.makeRows().Page), host);
    assert.equal(host.querySelector('main').textContent, 'aabb');
    stop();
  });
});

// The server writes a plain value as text with no markers, so the parser
// merges it with the static text around it: `Card 1 of 2.` is one text node.
// Each part claims its share of it in place, and a value that can change
// later gets a node of its own only when it first does.
const mergedSource = `import { signal } from 'what-framework';
  export function make(items) {
    const cards = signal(items);
    const live = signal('on');
    function Card(props) {
      return <p>Card {props.card.n} of {props.total}, {props.live}.</p>;
    }
    function Page(props) {
      return <main>{cards().map((card) => <Card key={card.id} card={card} total={props.items.length} live={live()} />)}</main>;
    }
    function Fields() {
      return <ul>{cards().map((card) => <li key={card.id}>#{card.id} {card.n}!</li>)}</ul>;
    }
    return { Page, Fields, cards, live };
  }`;
const mergedClient = await loadCompiled(mergedSource, { pluginOptions: { hydratable: true } });
const mergedServer = await loadCompiled(mergedSource, { pluginOptions: { generate: 'ssr' } });

describe('text the parser merged with a value is adopted without new nodes', () => {
  const items = () => [{ id: 1, n: 'a' }, { id: 2, n: 'b' }];

  it('a component\'s text from its props: no node added, and each part still updates', () => {
    const app = mergedClient.make(items());
    const html = server.renderToHydratableString(h(mergedServer.make(items()).Page, { items: items() }));
    const { host, reports, added, stop } = adopt(html, h(app.Page, { items: items() }));
    const [first, second] = host.querySelectorAll('p');
    assert.equal(first.childNodes.length, 1, html);
    assert.deepEqual(reports, []);
    assert.deepEqual(added, []);
    assert.equal(first.textContent, 'Card a of 2, on.');
    app.cards([{ id: 1, n: 'xyz' }, { id: 2, n: 'b' }]);
    flushSync();
    assert.equal(first.textContent, 'Card xyz of 2, on.');
    assert.equal(second.textContent, 'Card b of 2, on.');
    app.live('off');
    flushSync();
    assert.equal(first.textContent, 'Card xyz of 2, off.');
    assert.equal(second.textContent, 'Card b of 2, off.');
    app.cards([{ id: 1, n: 'q' }, { id: 2, n: 'r' }]);
    app.live('');
    flushSync();
    assert.equal(first.textContent, 'Card q of 2, .');
    assert.equal(second.textContent, 'Card r of 2, .');
    stop();
  });

  it('a reactive child that read nothing reactive keeps no markers of its own; one that did keeps them', () => {
    const count = signal(1);
    const tree = () => h('main', null, () => h('b', null, 'static'), () => h('i', null, count()));
    const { host, reports, added, stop } = adopt(server.renderToString(h(tree)), h(tree));
    assert.deepEqual(reports, []);
    assert.deepEqual(added, ['<!--$-->', '<!--/$-->']);
    count(2);
    flushSync();
    assert.equal(host.querySelector('main').innerHTML, '<b>static</b><!--$--><i>2</i><!--/$-->');
    stop();
  });

  it('a keyed row\'s fields of its item: no node added, and each field still updates', () => {
    const app = mergedClient.make(items());
    const { host, reports, added, stop } = adopt(server.renderToHydratableString(h(mergedServer.make(items()).Fields)), h(app.Fields));
    assert.deepEqual(reports, []);
    assert.deepEqual(added, []);
    const [first, second] = host.querySelectorAll('li');
    assert.equal(first.textContent, '#1 a!');
    app.cards([{ id: 1, n: 'long' }, { id: 2, n: '' }]);
    flushSync();
    assert.equal(first.textContent, '#1 long!');
    assert.equal(second.textContent, '#2 !');
    app.cards([{ id: 2, n: 'z' }, { id: 1, n: 'y' }]);
    flushSync();
    assert.deepEqual([...host.querySelectorAll('li')].map((li) => li.textContent), ['#2 z!', '#1 y!']);
    stop();
  });
});
