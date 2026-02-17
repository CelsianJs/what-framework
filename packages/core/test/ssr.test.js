// Tests for What Framework - Server-side rendering
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from '../src/h.js';
import { renderToString } from '../../server/src/index.js';

describe('renderToString', () => {
  it('should render a simple element', () => {
    const html = renderToString(h('div', null, 'Hello'));
    assert.equal(html, '<div>Hello</div>');
  });

  it('should render attributes', () => {
    const html = renderToString(h('div', { class: 'test', id: 'main' }));
    assert.equal(html, '<div class="test" id="main"></div>');
  });

  it('should render nested elements', () => {
    const html = renderToString(
      h('div', null,
        h('h1', null, 'Title'),
        h('p', null, 'Body'),
      )
    );
    assert.equal(html, '<div><h1>Title</h1><p>Body</p></div>');
  });

  it('should render void elements without closing tag', () => {
    const html = renderToString(h('br', null));
    assert.equal(html, '<br>');

    const img = renderToString(h('img', { src: 'test.png', alt: 'test' }));
    assert.equal(img, '<img src="test.png" alt="test">');
  });

  it('should escape HTML in text content', () => {
    const html = renderToString(h('div', null, '<script>alert("xss")</script>'));
    assert.equal(html, '<div>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</div>');
  });

  it('should escape HTML in attributes', () => {
    const html = renderToString(h('div', { title: 'a"b<c' }));
    assert.equal(html, '<div title="a&quot;b&lt;c"></div>');
  });

  it('should render components', () => {
    function Greeting({ name }) {
      return h('span', null, 'Hello, ', name);
    }
    const html = renderToString(h(Greeting, { name: 'World' }));
    assert.equal(html, '<span>Hello, World</span>');
  });

  it('should render boolean attributes', () => {
    const html = renderToString(h('input', { disabled: true, type: 'text' }));
    assert.equal(html, '<input disabled type="text">');
  });

  it('should skip false/null attributes', () => {
    const html = renderToString(h('div', { hidden: false, class: null }));
    assert.equal(html, '<div></div>');
  });

  it('should skip event handlers', () => {
    const html = renderToString(h('button', { onClick: () => {} }, 'Click'));
    assert.equal(html, '<button>Click</button>');
  });

  it('should render className as class', () => {
    const html = renderToString(h('div', { className: 'foo' }));
    assert.equal(html, '<div class="foo"></div>');
  });

  it('should render style objects', () => {
    const html = renderToString(h('div', { style: { color: 'red', fontSize: '16px' } }));
    assert.equal(html, '<div style="color:red;font-size:16px"></div>');
  });

  it('should render dangerouslySetInnerHTML content', () => {
    const html = renderToString(h('div', { dangerouslySetInnerHTML: { __html: '<b>Bold</b>' } }));
    assert.equal(html, '<div><b>Bold</b></div>');
  });

  it('should render innerHTML content (string and object)', () => {
    const stringHtml = renderToString(h('div', { innerHTML: '<i>Italic</i>' }));
    assert.equal(stringHtml, '<div><i>Italic</i></div>');

    const objectHtml = renderToString(h('div', { innerHTML: { __html: '<u>Underline</u>' } }));
    assert.equal(objectHtml, '<div><u>Underline</u></div>');
  });

  it('should not emit innerHTML attributes in SSR output', () => {
    const html = renderToString(h('div', {
      id: 'x',
      innerHTML: '<span>A</span>',
      dangerouslySetInnerHTML: { __html: '<span>B</span>' },
    }));
    assert.equal(html, '<div id="x"><span>B</span></div>');
  });

  it('should handle null/undefined/boolean children', () => {
    const html = renderToString(h('div', null, null, false, true, 'visible'));
    assert.equal(html, '<div>visible</div>');
  });

  it('should render arrays of VNodes', () => {
    const items = [h('li', null, 'A'), h('li', null, 'B')];
    const html = renderToString(h('ul', null, ...items));
    assert.equal(html, '<ul><li>A</li><li>B</li></ul>');
  });
});
