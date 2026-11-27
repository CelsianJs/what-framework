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

// A region the server marked holds what lies between its markers when it
// runs again: the text a part of merged text split off when its value
// changed, and the markers a region in it took to show an element.
const regionSource = `import { signal } from 'what-framework';
  export function make() {
    const show = signal(true);
    const count = signal(5);
    function Count(props) { return <>Count: {props.n}</>; }
    function Page() { return <main>{show() ? <Count n={count()} /> : 'none'}</main>; }
    return { Page, show, count };
  }`;
const regionClient = await loadCompiled(regionSource, { pluginOptions: { hydratable: true } });
const regionServer = await loadCompiled(regionSource, { pluginOptions: { generate: 'ssr' } });

describe('a region adopted around merged text removes all of it when it shows something else', () => {
  for (const [label, next] of [['a part written', 6], ['a part that became an element', h('b', null, 'six')]]) {
    it(`${label}`, () => {
      const app = regionClient.make();
      const { host, reports, stop } = adopt(server.renderToHydratableString(h(regionServer.make().Page)), h(app.Page));
      assert.deepEqual(reports, []);
      app.count(next);
      flushSync();
      assert.equal(host.querySelector('main').textContent, `Count: ${typeof next === 'number' ? next : 'six'}`);
      app.show(false);
      flushSync();
      assert.equal(host.querySelector('main').textContent, 'none');
      app.show(true);
      flushSync();
      assert.equal(host.querySelector('main').textContent, `Count: ${typeof next === 'number' ? next : 'six'}`);
      stop();
    });
  }
});

// A value the server wrote as text with no markers, and that renders nothing
// on the client, stands where the server's text starts: that text is what
// follows it unless the next claim's own text starts later in it, and only
// then is the text before that the server's value for it, reported and
// removed.
const emptySource = `import { signal } from 'what-framework';
  export function make(init) {
    const s = {};
    for (const k of Object.keys(init)) s[k] = signal(init[k]);
    function Prefix(props) { return <p>{props.prefix}static text</p>; }
    function Icon(props) { return <p>{props.icon}{props.label}</p>; }
    function Twice(props) { return <p>{props.a}{props.b}static text</p>; }
    function Between(props) { return <p>{props.a}{props.mid}{props.b}</p>; }
    function Inside(props) { return <p>Hi {props.mid}{props.b}!</p>; }
    function Marked(props) { return <p>{props.icon}{s.count()}</p>; }
    function Rows(props) { return <ul>{s.rows().map((row) => <li key={row.id}>{props.icon}{row.name} items</li>)}</ul>; }
    return {
      s,
      Prefix: () => <Prefix prefix={s.prefix()} />,
      Icon: () => <Icon icon={s.icon()} label={s.label()} />,
      Twice: () => <Twice a={s.a()} b={s.b()} />,
      Between: () => <Between a={s.a()} mid={s.mid()} b={s.b()} />,
      Inside: () => <Inside mid={s.mid()} b={s.b()} />,
      Marked: () => <Marked icon={s.icon()} />,
      Rows: () => <Rows icon={s.icon()} />,
    };
  }`;
const emptyClient = await loadCompiled(emptySource, { pluginOptions: { hydratable: true } });
const emptyServer = await loadCompiled(emptySource, { pluginOptions: { generate: 'ssr' } });

// Hydrate the compiled `page` rendered on the server from `serverInit`, on the
// client from `clientInit`; the server's text nodes, then, for comparison.
function adoptEmpty(page, serverInit, clientInit = serverInit) {
  const app = emptyClient.make(clientInit);
  const html = server.renderToHydratableString(h(emptyServer.make(serverInit)[page]));
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = html;
  const texts = nodesOf(host).filter((n) => n.nodeType === 3);
  const before = nodesOf(host);
  const reports = [];
  const stop = hydrate(h(app[page]), host, { onHydrationError: (r) => reports.push([r.kind, r.expected, r.found]) });
  const added = nodesOf(host).filter((n) => !before.includes(n)).map((n) => (n.nodeType === 8 ? `<!--${n.data}-->` : n.nodeName));
  return { app, p: host.querySelector('p'), texts, reports, added, stop };
}

describe('an empty value before text the server merged', () => {
  it('an empty value, then static text: no report, and the server\'s text node stays', () => {
    const { app, p, texts, reports, added, stop } = adoptEmpty('Prefix', { prefix: '' });
    assert.deepEqual(reports, []);
    assert.deepEqual(added, ['<!--$-->', '<!--/$-->']);
    assert.equal(p.lastChild, texts[0]);
    app.s.prefix('> ');
    flushSync();
    assert.equal(p.textContent, '> static text');
    assert.equal(p.lastChild, texts[0]);
    app.s.prefix('');
    flushSync();
    assert.equal(p.textContent, 'static text');
    stop();
  });

  it('a null value, then a value: no report, and the value keeps the server\'s node', () => {
    const { app, p, texts, reports, added, stop } = adoptEmpty('Icon', { icon: null, label: 'Hello' });
    assert.deepEqual(reports, []);
    assert.deepEqual(added, ['<!--$-->', '<!--/$-->']);
    assert.equal(p.lastChild, texts[0]);
    app.s.label('Bye');
    flushSync();
    assert.equal(p.textContent, 'Bye');
    assert.equal(p.lastChild, texts[0]);
    app.s.icon('*');
    flushSync();
    assert.equal(p.textContent, '*Bye');
    stop();
  });

  it('a null prop, then a reactive child the server marked: the child keeps its markers and text', () => {
    const { app, p, texts, reports, added, stop } = adoptEmpty('Marked', { icon: null, count: 1 });
    assert.deepEqual(reports, []);
    assert.deepEqual(added, ['<!--$-->', '<!--/$-->']);
    assert.equal(p.textContent, '1');
    app.s.count(2);
    flushSync();
    assert.equal(p.textContent, '2');
    assert.equal(texts[0].data, '2');
    app.s.icon('*');
    flushSync();
    assert.equal(p.textContent, '*2');
    stop();
  });

  it('h(): a reactive child after static text, showing an array with a reactive child, in markup without markers', () => {
    const a = signal('A');
    const b = signal('B');
    const tree = () => h('p', null, 'st', () => [() => a(), ' ', b()]);
    const host = document.body.appendChild(document.createElement('div'));
    host.innerHTML = server.renderToString(h(tree));
    const reports = [];
    const stop = hydrate(h(tree), host, { onHydrationError: (r) => reports.push(r.kind) });
    const p = host.querySelector('p');
    assert.deepEqual(reports, []);
    a('Q');
    flushSync();
    assert.equal(p.textContent, 'stQ B');
    b('Z');
    flushSync();
    assert.equal(p.textContent, 'stQ Z');
    a('R');
    flushSync();
    assert.equal(p.textContent, 'stR Z');
    stop();
  });

  it('h(): a null reactive child, then one with text, in markup without markers', () => {
    const icon = signal(null);
    const label = signal('Hello');
    const tree = () => h('p', null, () => icon(), () => label());
    const host = document.body.appendChild(document.createElement('div'));
    host.innerHTML = server.renderToString(h(tree));
    const text = host.querySelector('p').firstChild;
    const reports = [];
    const stop = hydrate(h(tree), host, { onHydrationError: (r) => reports.push(r.kind) });
    assert.deepEqual(reports, []);
    assert.equal(host.querySelector('p').lastChild, text);
    icon('*');
    label('Bye');
    flushSync();
    assert.equal(host.querySelector('p').textContent, '*Bye');
    stop();
  });

  it('an empty value, then a keyed row\'s field, empty or not', () => {
    const rows = [{ id: 1, name: '' }, { id: 2, name: 'b' }];
    const { app, reports, stop } = adoptEmpty('Rows', { icon: null, rows });
    assert.deepEqual(reports, []);
    const ul = document.body.lastChild.querySelector('ul');
    assert.equal(ul.textContent, ' itemsb items');
    app.s.rows([{ id: 1, name: 'x' }, { id: 2, name: 'y' }]);
    app.s.icon('*');
    flushSync();
    assert.equal(ul.textContent, '*x items*y items');
    stop();
  });

  it('two empty values, then static text', () => {
    const { app, p, texts, reports, stop } = adoptEmpty('Twice', { a: '', b: null });
    assert.deepEqual(reports, []);
    assert.equal(p.lastChild, texts[0]);
    app.s.b('2');
    app.s.a('1');
    flushSync();
    assert.equal(p.textContent, '12static text');
    stop();
  });

  it('an empty value between two texts', () => {
    for (const [page, init, shown, next] of [
      ['Between', { a: 'x', mid: '', b: 'y' }, 'xy', 'x-y'],
      ['Inside', { mid: null, b: 'Ann' }, 'Hi Ann!', 'Hi -Ann!'],
    ]) {
      const { app, p, reports, stop } = adoptEmpty(page, init);
      assert.deepEqual(reports, [], page);
      assert.equal(p.textContent, shown);
      app.s.mid('-');
      flushSync();
      assert.equal(p.textContent, next);
      app.s.mid('');
      app.s.b('Bo');
      flushSync();
      assert.equal(p.textContent, shown.replace(page === 'Between' ? 'y' : 'Ann', 'Bo'));
      stop();
    }
  });

  it('a value the server rendered and the client renders empty is still reported and removed', () => {
    for (const [page, serverInit, clientInit, found, shown] of [
      ['Prefix', { prefix: 'Hi ' }, { prefix: '' }, '"Hi "', 'static text'],
      ['Icon', { icon: '*', label: 'Hello' }, { icon: null, label: 'Hello' }, '"*"', 'Hello'],
      ['Twice', { a: 'A', b: 'B' }, { a: '', b: '' }, '"AB"', 'static text'],
    ]) {
      const { app, p, reports, stop } = adoptEmpty(page, serverInit, clientInit);
      assert.deepEqual(reports, [['text', '""', found]], page);
      assert.equal(p.textContent, shown);
      const key = Object.keys(clientInit)[0];
      app.s[key]('>');
      flushSync();
      assert.equal(p.textContent, '>' + shown);
      stop();
    }
  });

  it('a value after an empty one that differs from the server\'s is the one reported', () => {
    const { app, p, reports, stop } = adoptEmpty('Icon', { icon: null, label: 'Hello' }, { icon: null, label: 'Bye' });
    assert.deepEqual(reports, [['text', '"Bye"', '"Hello"']]);
    assert.equal(p.textContent, 'Bye');
    app.s.label('Hi');
    flushSync();
    assert.equal(p.textContent, 'Hi');
    stop();
  });
});

// A keyed row whose output is a reactive child (a <Show> per row, a row
// component that returns a function) starts at the server's markers for it:
// a row that shows nothing leaves the text of the row after it to that row,
// and each row moves with its own nodes.
const shownSource = `import { For, Show, signal } from 'what-framework';
  export function make(initial) {
    const rows = signal(initial.map(([label, on]) => ({ label, on: signal(on) })));
    function Page() { return <ul><For each={rows()}>{(row) => <Show when={row.on()}>{row.label}</Show>}</For></ul>; }
    return { Page, rows };
  }
  export function makeLabels(initial) {
    const rows = signal(initial.map(([label, on]) => ({ label, on: signal(on) })));
    function Label(props) { return props.text; }
    function Page() { return <ul><For each={rows()}>{(row) => <Label text={row.on() ? row.label : null} />}</For></ul>; }
    function Keyed() { return <ul>{rows().map((row) => <Label key={row.label} text={row.on() ? row.label : null} />)}</ul>; }
    return { Page, Keyed, rows };
  }`;
const shownClient = await loadCompiled(shownSource, { pluginOptions: { hydratable: true } });
const shownServer = await loadCompiled(shownSource, { pluginOptions: { generate: 'ssr' } });

function hShown(initial) {
  const rows = signal(initial.map(([label, on]) => ({ label, on: signal(on) })));
  const Row = (props) => () => (props.row.on() ? props.row.label : null);
  const Page = () => h('ul', null, () => rows().map((row) => h(Row, { key: row.label, row })));
  return { Page, rows };
}

// Rows a, b, c, d with b and d shown: hydrated, then moved and toggled.
function hydrateShown(html, app) {
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = html;
  const ul = host.querySelector('ul');
  const texts = nodesOf(ul).filter((n) => n.nodeType === 3);
  const reports = [];
  const stop = hydrate(h(app.Page), host, { onHydrationError: (r) => reports.push([r.kind, r.expected, r.found]) });
  const kept = nodesOf(ul).filter((n) => n.nodeType === 3);
  const shown = [ul.textContent];
  const rows = app.rows();
  for (const step of [
    () => app.rows([rows[3], rows[2], rows[1], rows[0]]),
    () => { rows[0].on(true); rows[1].on(false); },
    () => app.rows(rows),
  ]) {
    step();
    flushSync();
    shown.push(ul.textContent);
  }
  stop();
  return { reports, texts, kept, shown };
}
const SHOWN = [['a', false], ['b', true], ['c', false], ['d', true]];

describe('a keyed row whose output is a reactive child', () => {
  for (const [label, serverMake, clientMake] of [['compiled <For> of <Show>', shownServer.make, shownClient.make], ['h() rows of a component returning a function', hShown, hShown]]) {
    it(`${label}: a row that shows nothing leaves the next row's text alone, and each row moves whole`, () => {
      const { reports, texts, shown } = hydrateShown(server.renderToHydratableString(h(serverMake(SHOWN).Page)), clientMake(SHOWN));
      assert.deepEqual(reports, []);
      assert.equal(texts.length, 2);
      assert.deepEqual(shown, ['bd', 'db', 'da', 'ad']);
    });
  }
});

// The server writes a live prop's value with no markers, as renderToString
// writes every value: a row whose text a region without markers holds starts
// at a node of the row's own, so the row moves whole once that text is gone.
describe('a keyed row whose text a region without markers holds', () => {
  for (const [label, render, serverMake, clientMake] of [
    ['compiled <For> of a component placing a live prop', server.renderToHydratableString, shownServer.makeLabels, shownClient.makeLabels],
    ['a compiled keyed .map() of the same', server.renderToHydratableString, (i) => ({ ...shownServer.makeLabels(i), Page: shownServer.makeLabels(i).Keyed }), (i) => { const app = shownClient.makeLabels(i); return { ...app, Page: app.Keyed }; }],
    ['compiled <For> of <Show>, from renderToString', server.renderToString, shownServer.make, shownClient.make],
    ['h() rows of a component returning a function, from renderToString', server.renderToString, hShown, hShown],
  ]) {
    it(`${label}: no report, the server's text kept, and a hidden row's text stays gone`, () => {
      const { reports, texts, kept, shown } = hydrateShown(render(h(serverMake(SHOWN).Page)), clientMake(SHOWN));
      assert.deepEqual(reports, []);
      // The parser merged the rows' text ("bd"): split where a row ends.
      assert.equal(texts.length, 1);
      assert.equal(kept[0], texts[0]);
      assert.deepEqual(shown, ['bd', 'db', 'da', 'ad']);
    });
  }
});

// Rows the server did not render (other keys: the client builds the list) are
// built as a client render builds them, not claimed from where the walk
// stands.
describe('keyed rows the server rendered with other keys', () => {
  for (const [label, page] of [['a compiled keyed .map()', 'Keyed']]) {
    it(`${label} of a component placing a live prop: the rows built on the client move whole`, () => {
      const app = shownClient.makeLabels([['a', true], ['b', true]]);
      const html = server.renderToHydratableString(h(shownServer.makeLabels([['c', true], ['a', true], ['b', true]])[page]));
      const host = document.body.appendChild(document.createElement('div'));
      host.innerHTML = html;
      const errors = [];
      const saved = console.error;
      console.error = (...args) => errors.push(args.map(String).join(' '));
      try {
        const reports = [];
        const stop = hydrate(h(app[page]), host, { onHydrationError: (r) => reports.push(r.kind) });
        const ul = host.querySelector('ul');
        assert.ok(reports.length > 0);
        assert.equal(ul.textContent, 'ab');
        const rows = app.rows();
        rows[0].on(false);
        flushSync();
        assert.equal(ul.textContent, 'b');
        app.rows([rows[1], rows[0]]);
        flushSync();
        rows[0].on(true);
        flushSync();
        assert.equal(ul.textContent, 'ba');
        assert.deepEqual(errors.filter((e) => !e.includes('ERR_HYDRATION_MISMATCH')), []);
        stop();
      } finally {
        console.error = saved;
      }
    });
  }
});
