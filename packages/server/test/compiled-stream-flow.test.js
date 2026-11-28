// How the stream goes through compiled markup. Markup writes its finished
// HTML, its reactive attributes and its keyed rows' edges straight into the
// stream's segment, and hands the stream only the parts it has to render (a
// reactive child, a component, markup of another kind), with the rest of the
// markup queued behind each one. What the stream writes, and the order every
// hole runs in, must be what the hydratable string renderer writes and runs:
// in document order, a reactive attribute where it stands between the parts
// around it, and the rest of a failed component's markup still closed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { collect, content, keyShape, settle, stableIds } from './stream-helpers.js';
import { renderToString, renderToHydratableString, renderToStream, renderToStringAsync } from '../src/index.js';

const { h } = await import('what-framework');

const log = [];
globalThis.__flowLog = log;

const mod = await loadCompiled(`
  import { Suspense, ErrorBoundary } from 'what-framework';
  const log = globalThis.__flowLog;
  const say = (tag, value) => { log.push(tag); return value; };

  function Badge(props) {
    log.push('Badge:' + props.n);
    return <b class="badge" title={say('badge-title:' + props.n, 't' + props.n)}>{props.n}</b>;
  }

  function Broken() {
    log.push('Broken');
    throw new Error('broken component');
  }

  // Reactive attributes before, between and after the parts the stream
  // renders, in one template.
  export function Mixed(props) {
    return (
      <section class={say('section-class', props.on() ? 'on' : '')} id="s">
        <h2 title={say('h2-title', props.title())}>Title</h2>
        <p>{say('text', props.text())}</p>
        <Badge n={1} />
        <a href={say('href', props.href())} class={say('a-class', 'link')}>go</a>
        <Badge n={2} />
        <footer data-x={say('footer-x', 'x')}>end</footer>
      </section>
    );
  }

  // Keyed lists: rows that defer only a reactive attribute, and rows that
  // hold a component too.
  export function Plain(props) {
    return <ol>{props.items().map((item) => <li key={item.id} class={say('plain-class:' + item.id, props.on() === item.id ? 'on' : '')}>{item.name}</li>)}</ol>;
  }

  export function Rows(props) {
    return (
      <ul>{props.items().map((item) => (
        <li key={item.id} class={say('row-class:' + item.id, props.on() === item.id ? 'on' : '')}>{item.name}<Badge n={item.id} /></li>
      ))}</ul>
    );
  }

  export function Lists(props) {
    return <div><Plain items={props.items} on={props.on} /><Rows items={props.items} on={props.on} /><Badge n={9} /></div>;
  }

  // Markup with a child handed in, which may fail where the stream places it.
  function Card(props) {
    return (
      <div class="card">
        <span class={say('card-class', 'a')}>before</span>
        {props.child}
        <i title={say('card-after', 'late')}>after</i>
        <Badge n={4} />
        <em>tail</em>
      </div>
    );
  }

  export const broken = () => <Broken />;

  export function Failing(props) {
    return (
      <main>
        <Card child={props.child} />
        <Rows items={props.items} on={props.on} />
        <p class={say('main-after', 'z')}>outside</p>
      </main>
    );
  }

  export function Guarded(props) {
    return (
      <main>
        <ErrorBoundary fallback={<p class="fallback">failed</p>}>
          <Card child={props.child} />
        </ErrorBoundary>
        <p>outside</p>
      </main>
    );
  }

  export function Waiting(props) {
    return (
      <main>
        <Suspense fallback={<p class="loading">loading</p>}>
          <div class={say('wait-class', 'w')}>
            <span>{props.data()}</span>
            <a href={say('wait-href', '/next')}>next</a>
            <Rows items={props.items} on={props.on} />
          </div>
        </Suspense>
        <p>outside</p>
      </main>
    );
  }

  export function WaitingInPlace(props) {
    return <div class={say('place-class', 'w')}><span>{props.data()}</span><a href={say('place-href', '/next')}>next</a><Badge n={5} /></div>;
  }
`, { pluginOptions: { generate: 'ssr' } });

const items = [{ id: 1, name: 'one' }, { id: 2, name: 'two' }, { id: 3, name: 'three' }];
const ROWS = (on) => items.map((item) => `<li class="${item.id === on ? 'on' : ''}">${item.name}<b class="badge" title="t${item.id}">${item.id}</b></li>`).join('');
const ROW_ORDER = items.map((item) => `row-class:${item.id}>Badge:${item.id}>badge-title:${item.id}`).join('>');

const streamed = async (tree, options) => stableIds(await collect(renderToStream(tree, { onError: () => {}, ...options })));

// A fresh accessor that suspends until its promise settles.
function slow(value) {
  let done = false;
  let pending = null;
  return () => {
    if (done) return value;
    pending ??= new Promise((resolve) => setTimeout(() => { done = true; resolve(); }, 2));
    throw pending;
  };
}

describe('the stream writes compiled markup as the hydratable string renderer does', () => {
  it('a template with reactive attributes around the parts the stream renders', async () => {
    const tree = () => h(mod.Mixed, { on: () => true, title: () => 'a "title"', text: () => 'some <text>', href: () => '/path?a=1&b=2' });
    log.length = 0;
    const string = renderToHydratableString(tree());
    const stringOrder = log.join('>');
    log.length = 0;
    const stream = await streamed(tree());
    assert.equal(stream, string);
    assert.equal(log.join('>'), stringOrder);
    assert.equal(stringOrder, 'section-class>h2-title>text>Badge:1>badge-title:1>href>a-class>Badge:2>badge-title:2>footer-x');
    assert.equal(content(stream), renderToString(tree()));
    assert.equal(content(stream),
      '<section class="on" id="s"><h2 title="a &quot;title&quot;">Title</h2><p>some &lt;text&gt;</p><b class="badge" title="t1">1</b>'
      + '<a href="/path?a=1&amp;b=2" class="link">go</a><b class="badge" title="t2">2</b><footer data-x="x">end</footer></section>');
  });

  it('keyed lists whose rows hold a reactive attribute, with and without a component', async () => {
    const tree = () => h(mod.Lists, { items: () => items, on: () => 3 });
    log.length = 0;
    const string = renderToHydratableString(tree());
    const stringOrder = log.join('>');
    log.length = 0;
    const stream = await streamed(tree());
    assert.equal(keyShape(stream), keyShape(string));
    assert.equal(log.join('>'), stringOrder);
    assert.equal(stringOrder, `plain-class:1>plain-class:2>plain-class:3>${ROW_ORDER}>Badge:9>badge-title:9`);
    assert.equal(content(stream),
      `<div><ol><li class="">one</li><li class="">two</li><li class="on">three</li></ol><ul>${ROWS(3)}</ul><b class="badge" title="t9">9</b></div>`);
    // The components' keys: the page's, the two lists', each row's badge in
    // its list's component, then the badge after the lists.
    assert.deepEqual(stream.match(/data-hk="[^"]*"/g), ['data-hk="0"', 'data-hk="00"', 'data-hk="01"', 'data-hk="010"', 'data-hk="011"', 'data-hk="012"', 'data-hk="02"']);
    assert.match(stream, /<ol data-hk="00"><!--\$--><!--\[\]--><!--k:[^>]+--><li class="">one<\/li><li class="">two<\/li><li class="on">three<\/li><!--\/\[\]--><!--\/\$--><\/ol>/);
  });

  it('an unsafe reactive URL is dropped and a throwing reactive attribute skipped, where they stand', async () => {
    const tree = () => h(mod.Mixed, {
      on: () => { throw new Error('no class'); }, title: () => () => 'a function', text: () => 't', href: () => ' javascript:alert(1)',
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const stream = await streamed(tree());
      assert.equal(stream, renderToHydratableString(tree()));
      assert.equal(content(stream),
        '<section id="s"><h2>Title</h2><p>t</p><b class="badge" title="t1">1</b><a class="link">go</a><b class="badge" title="t2">2</b><footer data-x="x">end</footer></section>');
    } finally {
      console.warn = warn;
    }
  });
});

describe('the stream goes through compiled markup with pour()', () => {
  // Markup's parts() gives the stream the same output, one queued item for
  // each part: the stream must not fall back to it unnoticed.
  it('never asks markup for its parts, with every kind of part in the tree', async () => {
    const tree = () => h(mod.Failing, { child: h(mod.Mixed, { on: () => true, title: () => 't', text: () => 'x', href: () => '/' }), items: () => items, on: () => 1 });
    // The class of compiled markup, from a template with holes.
    const Markup = Object.getPrototypeOf(mod.Mixed({ on: () => true, title: () => 't', text: () => 'x', href: () => '/' }));
    assert.equal(typeof Markup.pour, 'function');
    const { pour, parts } = Markup;
    const calls = { pour: 0, parts: 0, resumed: 0 };
    Markup.pour = function (put, seg, from, frame, root, skip) {
      calls.pour++;
      if (from > 0) calls.resumed++;
      return pour.call(this, put, seg, from, frame, root, skip);
    };
    Markup.parts = function (ns) {
      calls.parts++;
      return parts.call(this, ns);
    };
    let stream;
    try {
      stream = await streamed(tree());
    } finally {
      Markup.pour = pour;
      Markup.parts = parts;
    }
    assert.equal(keyShape(stream), keyShape(renderToHydratableString(tree())));
    assert.equal(calls.parts, 0);
    // Every markup is poured, and poured again after each part it holds.
    assert.ok(calls.pour > calls.resumed && calls.resumed > 0, JSON.stringify(calls));
  });
});

describe('the stream and a child that fails inside compiled markup', () => {
  it('a component: an error comment in its place, and the markup around it goes on', async () => {
    log.length = 0;
    const stream = await streamed(h(mod.Failing, { child: mod.broken(), items: () => items, on: () => 1 }));
    assert.equal(content(stream),
      '<main><div class="card"><span class="a">before</span><!-- SSR Error --><i title="late">after</i><b class="badge" title="t4">4</b><em>tail</em></div>'
      + `<ul>${ROWS(1)}</ul><p class="z">outside</p></main>`);
    assert.equal(log.join('>'), `card-class>Broken>card-after>Badge:4>badge-title:4>${ROW_ORDER}>main-after`);
  });

  it('a child the stream refuses: the rest of its component\'s markup is closed and not rendered, then the error comment, and the page goes on', async () => {
    log.length = 0;
    // A tag name no renderer writes: the stream throws where it places it.
    const stream = await streamed(h(mod.Failing, { child: h('bad tag', null), items: () => items, on: () => 1 }));
    assert.equal(content(stream),
      '<main><div class="card"><span class="a">before</span><i>after</i><em>tail</em></div><!-- SSR Error -->'
      + `<ul>${ROWS(1)}</ul><p class="z">outside</p></main>`);
    assert.equal(log.join('>'), `card-class>${ROW_ORDER}>main-after`);
  });

  it('inside an <ErrorBoundary>: its fallback, as the string renderers show it', async () => {
    for (const child of [() => mod.broken(), () => h('bad tag', null)]) {
      const tree = () => h(mod.Guarded, { child: child() });
      const stream = await streamed(tree());
      assert.equal(content(stream), '<main><p class="fallback">failed</p><p>outside</p></main>');
      assert.equal(content(stream), renderToString(tree()));
      assert.equal(stream, renderToHydratableString(tree()));
    }
  });
});

describe('the stream and a reactive child that suspends inside compiled markup', () => {
  it('inside a <Suspense>: the fallback first, then the markup with every part after the child', async () => {
    log.length = 0;
    const html = await streamed(h(mod.Waiting, { data: slow('ready'), items: () => items, on: () => 2 }));
    assert.match(html, /<p class="loading">loading<\/p>/);
    assert.ok(html.indexOf('loading') < html.indexOf('ready'), 'the fallback was not sent first');
    const expected = `<main><div class="w"><span>ready</span><a href="/next">next</a><ul>${ROWS(2)}</ul></div><p>outside</p></main>`;
    assert.equal(content(settle(html)), expected);
    assert.equal(log.join('>'), `wait-class>wait-href>${ROW_ORDER}`);

    const { body } = await renderToStringAsync(h(mod.Waiting, { data: slow('ready'), items: () => items, on: () => 2 }), undefined, { onError: () => {} });
    assert.equal(content(body), expected);
  });

  it('outside one: the stream waits in place and then writes the rest', async () => {
    log.length = 0;
    const html = await streamed(h(mod.WaitingInPlace, { data: slow('ready') }));
    assert.equal(content(html), '<div class="w"><span>ready</span><a href="/next">next</a><b class="badge" title="t5">5</b></div>');
    assert.equal(log.join('>'), 'place-class>place-href>Badge:5>badge-title:5');
  });
});
