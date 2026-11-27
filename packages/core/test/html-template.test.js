// The html tagged template (docs/API.md: "Tagged template vnode API", the
// no-build alternative to JSX). Each template is checked against the h() call
// that JSX would compile to, then rendered on the server and mounted on the
// client. Interpolated values are data: no value, however it is written, can
// add an element or an attribute the template did not write.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { html, h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { signal } = await import('../src/reactive.js');
const { renderToString } = await import('../../server/src/index.js');

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => queueMicrotask(r)); };

function mounted(vnode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const dispose = mount(vnode, el);
  return { el, dispose: () => { dispose(); el.remove(); } };
}

function clientHTML(vnode) {
  const { el, dispose } = mounted(vnode);
  const out = el.innerHTML;
  dispose();
  return out;
}

describe('html: the same vnode as h()', () => {
  const name = 'Alice';
  const onClick = () => {};
  const cases = [
    ['an element with a static attribute', () => html`<div class="box">hi</div>`, () => h('div', { class: 'box' }, 'hi')],
    ['an interpolated attribute', () => html`<div id=${name}></div>`, () => h('div', { id: name })],
    ['a quoted single interpolation keeps the value', () => html`<div data-n="${3}"></div>`, () => h('div', { 'data-n': 3 })],
    ['an unquoted static value', () => html`<div class=box></div>`, () => h('div', { class: 'box' })],
    ['a boolean attribute', () => html`<input disabled />`, () => h('input', { disabled: true })],
    ['an empty quoted value', () => html`<input value="" />`, () => h('input', { value: '' })],
    ['text around an interpolation keeps its spaces', () => html`<p>Hello ${name}!</p>`, () => h('p', null, 'Hello ', name, '!')],
    ['whitespace with line breaks goes, as in JSX', () => html`
      <ul>
        <li>a</li>
        <li>
          two
          words
        </li>
      </ul>`, () => h('ul', null, h('li', null, 'a'), h('li', null, 'two words'))],
    ['an event handler', () => html`<button onClick=${onClick}>go</button>`, () => h('button', { onClick }, 'go')],
    ['a spread', () => html`<a ...${{ href: '/x', title: 't' }}>x</a>`, () => h('a', { href: '/x', title: 't' }, 'x')],
    ['a bare interpolation in attribute position spreads', () => html`<a ${{ href: '/x' }}>x</a>`, () => h('a', { href: '/x' }, 'x')],
    ['void elements take no children', () => html`<p>a<br>b<img src="/i.png">c</p>`, () => h('p', null, 'a', h('br'), 'b', h('img', { src: '/i.png' }), 'c')],
    ['self-closing elements', () => html`<div><span /><i/></div>`, () => h('div', null, h('span'), h('i'))],
    ['nested templates', () => html`<ul>${[1, 2].map(i => html`<li>${i}</li>`)}</ul>`, () => h('ul', null, [h('li', null, 1), h('li', null, 2)])],
    ['several roots make an array', () => html`<a></a><b></b>`, () => [h('a'), h('b')]],
    ['an SVG subtree', () => html`<svg viewBox="0 0 2 2"><path d="M0 0L2 2"/></svg>`, () => h('svg', { viewBox: '0 0 2 2' }, h('path', { d: 'M0 0L2 2' }))],
    ['a comment is dropped', () => html`<p><!-- note -->x</p>`, () => h('p', null, 'x')],
    ['a < that starts no tag is text', () => html`<p>1 < 2</p>`, () => h('p', null, '1 < 2')],
  ];
  for (const [title, fromHtml, fromH] of cases) {
    it(title, () => {
      assert.deepEqual(fromHtml(), fromH());
      assert.equal(renderToString(fromHtml()), renderToString(fromH()));
    });
  }
});

describe('html: interpolated components', () => {
  const Card = ({ title, children }) => h('section', null, h('h2', null, title), children);

  it('renders <${Component} /> with its props', () => {
    assert.equal(renderToString(html`<${Card} title="T" />`), '<section><h2>T</h2></section>');
  });

  it('passes children and closes on </${Component}> or <//>', () => {
    const a = html`<${Card} title=${'A'}><p>body</p></${Card}>`;
    const b = html`<${Card} title=${'A'}><p>body</p><//>`;
    assert.deepEqual(a, h(Card, { title: 'A' }, h('p', null, 'body')));
    assert.deepEqual(b, a);
    assert.equal(clientHTML(a).replace(/<!--[^>]*-->/g, ''), '<section><h2>A</h2><p>body</p></section>');
  });
});

describe('html: malformed input still ends', () => {
  // Each of these used to loop forever in the parser.
  const cases = {
    'a stray closing tag': () => html`</p>x`,
    'a closing tag of another element': () => html`<div><span>a</div>b`,
    'a closing tag with spaces': () => html`<div>a</div >`,
    'an unclosed element': () => html`<div><span>a`,
    'an unclosed comment': () => html`<p>a<!-- b`,
    'an unclosed attribute quote': () => html`<div title="a>b`,
    'a lone <': () => html`<`,
    'a < before a digit': () => html`<p>a <3 b</p>`,
    'an attribute name the parser does not know': () => html`<div "x" =></div>`,
  };
  for (const [title, make] of Object.entries(cases)) {
    it(title, () => {
      const vnode = make();
      assert.equal(typeof renderToString(vnode), 'string');
      clientHTML(vnode);
    });
  }

  it('closes the innermost element whatever the closing tag names', () => {
    assert.equal(renderToString(html`<div><span>a</div>b`), '<div><span>a</span>b</div>');
  });
});

describe('html: on the client', () => {
  it('wires events and reactive children', async () => {
    const count = signal(0);
    const { el, dispose } = mounted(html`<button onClick=${() => count(count() + 1)}>n=${count}</button>`);
    const button = el.querySelector('button');
    assert.equal(button.textContent, 'n=0');
    button.click();
    await flush();
    assert.equal(button.textContent, 'n=1');
    dispose();
  });

  it('keeps an attribute with text around a signal live', async () => {
    const state = signal('off');
    const { el, dispose } = mounted(html`<div class="lamp ${state}"></div>`);
    assert.equal(el.firstChild.className, 'lamp off');
    state('on');
    await flush();
    assert.equal(el.firstChild.className, 'lamp on');
    dispose();
  });

  it('builds the SVG subtree in the SVG namespace', () => {
    const { el, dispose } = mounted(html`<svg viewBox="0 0 2 2"><g><path d="M0 0"/></g></svg>`);
    assert.equal(el.querySelector('path').namespaceURI, 'http://www.w3.org/2000/svg');
    dispose();
  });

  it('gives form fields the values the server gives them', () => {
    const vnode = () => html`<form><label>Name <input name="n" value=${'a"b'}></label><br><textarea>${'t'}</textarea></form>`;
    const host = document.createElement('div');
    host.innerHTML = renderToString(vnode());
    const { el, dispose } = mounted(vnode());
    for (const root of [host, el]) {
      assert.equal(root.querySelector('input').value, 'a"b');
      assert.equal(root.querySelector('textarea').value, 't');
      assert.equal(root.querySelector('label').firstChild.data, 'Name ');
      assert.ok(root.querySelector('label + br'));
    }
    dispose();
  });
});

describe('html: an interpolated value cannot add markup', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    "' onmouseover='alert(1)",
    '\x000\x00',
    '</div><div id="injected">',
    '<!--',
    '/><svg onload=alert(1)>',
    ' onclick=alert(1) ',
  ];

  // Count elements and attributes on both sides of the wire: the server's
  // markup parsed by the browser, and the client's DOM.
  function shape(root) {
    const els = [...root.querySelectorAll('*')];
    return els.map(e => `${e.tagName}[${[...e.attributes].map(a => a.name).sort().join(',')}]`).join(' ');
  }
  function parsed(markup) {
    const host = document.createElement('div');
    host.innerHTML = markup;
    return host;
  }

  const slots = {
    text: v => html`<div><p>${v}</p></div>`,
    'quoted attribute': v => html`<div><p title="${v}"></p></div>`,
    'unquoted attribute': v => html`<div><p title=${v}></p></div>`,
    'text around it in an attribute': v => html`<div><p title="a ${v} b"></p></div>`,
    'a spread value': v => html`<div><p ...${{ title: v }}></p></div>`,
    'text beside a nested template': v => html`<div>${v}${html`<p title=${v}>${v}</p>`}</div>`,
  };
  const expected = {
    text: 'DIV[] P[]',
    'quoted attribute': 'DIV[] P[title]',
    'unquoted attribute': 'DIV[] P[title]',
    'text around it in an attribute': 'DIV[] P[title]',
    'a spread value': 'DIV[] P[title]',
    'text beside a nested template': 'DIV[] P[title]',
  };

  for (const [slot, make] of Object.entries(slots)) {
    it(`in ${slot}`, () => {
      for (const v of hostile) {
        const server = parsed(renderToString(make(v)));
        assert.equal(shape(server), expected[slot], `server, value ${JSON.stringify(v)}`);
        const { el, dispose } = mounted(make(v));
        assert.equal(shape(el), expected[slot], `client, value ${JSON.stringify(v)}`);
        assert.ok(el.textContent.includes(v) || el.querySelector('p').getAttribute('title').includes(v),
          `the value is kept as data: ${JSON.stringify(v)}`);
        dispose();
      }
    });
  }

  it('drops a javascript: URL and a string event handler, as h() does', () => {
    const vnode = () => html`<a href="${'javascript:alert(1)'}" onclick="${'alert(1)'}">x</a>`;
    assert.equal(renderToString(vnode()), '<a>x</a>');
    const { el, dispose } = mounted(vnode());
    const a = el.querySelector('a');
    assert.equal(a.getAttribute('href'), null);
    assert.equal(a.getAttribute('onclick'), null);
    dispose();
  });

  it('refuses a string innerHTML through a spread', () => {
    const original = console.warn;
    console.warn = () => {};
    try {
      const vnode = () => html`<div ...${{ innerHTML: '<img src=x onerror=alert(1)>' }}></div>`;
      assert.equal(renderToString(vnode()), '<div></div>');
      const { el, dispose } = mounted(vnode());
      assert.equal(el.querySelector('img'), null);
      dispose();
    } finally {
      console.warn = original;
    }
  });

  it('refuses a string used as a tag name', () => {
    assert.throws(() => renderToString(html`<${'img src=x onerror=alert(1)'} />`), /Invalid tag name/);
  });
});
