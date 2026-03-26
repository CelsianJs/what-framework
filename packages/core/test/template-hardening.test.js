/**
 * Template Hardening Tests — SVG Namespace & Table Element Wrapping
 *
 * Tests for Sprint 2 runtime fixes:
 * 1. SVG elements created in correct namespace via template()
 * 2. Table child elements (tr, td, th, etc.) parsed with proper parent context
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Set up DOM globals before importing framework modules
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.Node = dom.window.Node;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

// Stub customElements if not available
if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

// Now import framework
const { template, svgTemplate } = await import('../src/render.js');

// =====================================================
// SVG Namespace Support — template()
// =====================================================

describe('SVG namespace support in template()', () => {
  it('creates SVG elements with correct namespace for <svg> tag', () => {
    const factory = template('<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20z"></path></svg>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'svg');
    assert.equal(el.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(el.getAttribute('viewBox'), '0 0 24 24');
  });

  it('creates inner SVG elements with correct namespace via svgTemplate', () => {
    const factory = svgTemplate('<circle cx="12" cy="12" r="10"></circle>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'circle');
    assert.equal(el.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(el.getAttribute('cx'), '12');
    assert.equal(el.getAttribute('r'), '10');
  });

  it('auto-detects SVG path element in template()', () => {
    const factory = template('<path d="M0 0L10 10"></path>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'path');
    assert.equal(el.namespaceURI, 'http://www.w3.org/2000/svg');
  });

  it('auto-detects SVG rect element in template()', () => {
    const factory = template('<rect x="0" y="0" width="100" height="100"></rect>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'rect');
    assert.equal(el.namespaceURI, 'http://www.w3.org/2000/svg');
  });

  it('auto-detects SVG g element in template()', () => {
    const factory = template('<g><rect x="0" y="0" width="50" height="50"></rect></g>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'g');
    assert.equal(el.namespaceURI, 'http://www.w3.org/2000/svg');
  });

  it('produces cloneable SVG elements (multiple calls)', () => {
    const factory = template('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle></svg>');
    const el1 = factory();
    const el2 = factory();

    // Both should be valid SVG elements
    assert.equal(el1.tagName.toLowerCase(), 'svg');
    assert.equal(el2.tagName.toLowerCase(), 'svg');
    // They should be distinct DOM nodes
    assert.notStrictEqual(el1, el2);
    // Both should have the child circle
    assert.equal(el1.querySelector('circle')?.getAttribute('r'), '5');
    assert.equal(el2.querySelector('circle')?.getAttribute('r'), '5');
  });

  it('handles SVG with nested elements correctly', () => {
    const factory = template(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
        '<g>' +
          '<rect x="10" y="10" width="80" height="80"></rect>' +
          '<circle cx="50" cy="50" r="30"></circle>' +
        '</g>' +
      '</svg>'
    );
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'svg');
    assert.ok(el.querySelector('g'), 'should have g element');
    assert.ok(el.querySelector('rect'), 'should have rect element');
    assert.ok(el.querySelector('circle'), 'should have circle element');
  });

  it('does not affect regular HTML elements', () => {
    const factory = template('<div class="container"><p>Hello</p></div>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'div');
    assert.equal(el.namespaceURI, 'http://www.w3.org/1999/xhtml');
    assert.equal(el.querySelector('p').textContent, 'Hello');
  });
});

// =====================================================
// Table Element Wrapping — template()
// =====================================================

describe('table element wrapping in template()', () => {
  it('creates <tr> elements correctly when used as template root', () => {
    const factory = template('<tr><td>Cell 1</td><td>Cell 2</td></tr>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'tr');
    assert.equal(el.children.length, 2);
    assert.equal(el.children[0].tagName.toLowerCase(), 'td');
    assert.equal(el.children[0].textContent, 'Cell 1');
    assert.equal(el.children[1].textContent, 'Cell 2');
  });

  it('creates <td> elements correctly when used as template root', () => {
    const factory = template('<td>Cell Content</td>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'td');
    assert.equal(el.textContent, 'Cell Content');
  });

  it('creates <th> elements correctly when used as template root', () => {
    const factory = template('<th>Header</th>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'th');
    assert.equal(el.textContent, 'Header');
  });

  it('creates <thead> elements correctly when used as template root', () => {
    const factory = template('<thead><tr><th>A</th><th>B</th></tr></thead>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'thead');
    assert.ok(el.querySelector('tr'), 'should have tr child');
    assert.equal(el.querySelectorAll('th').length, 2);
  });

  it('creates <tbody> elements correctly when used as template root', () => {
    const factory = template('<tbody><tr><td>Data</td></tr></tbody>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'tbody');
    assert.ok(el.querySelector('td'), 'should have td descendant');
  });

  it('creates <tfoot> elements correctly when used as template root', () => {
    const factory = template('<tfoot><tr><td>Footer</td></tr></tfoot>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'tfoot');
    assert.ok(el.querySelector('td'), 'should have td descendant');
  });

  it('creates <colgroup> elements correctly when used as template root', () => {
    const factory = template('<colgroup><col></colgroup>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'colgroup');
  });

  it('produces cloneable table elements (multiple calls)', () => {
    const factory = template('<tr><td>A</td><td>B</td></tr>');
    const el1 = factory();
    const el2 = factory();

    assert.equal(el1.tagName.toLowerCase(), 'tr');
    assert.equal(el2.tagName.toLowerCase(), 'tr');
    assert.notStrictEqual(el1, el2);
    assert.equal(el1.children[0].textContent, 'A');
    assert.equal(el2.children[0].textContent, 'A');
  });

  it('handles complete <table> without wrapping (not a table child)', () => {
    const factory = template('<table><tbody><tr><td>X</td></tr></tbody></table>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'table');
    assert.ok(el.querySelector('td'), 'should have td descendant');
    assert.equal(el.querySelector('td').textContent, 'X');
  });

  it('handles <tr> with comment markers for dynamic content', () => {
    const factory = template('<tr><td>Static</td><!--$--></tr>');
    const el = factory();

    assert.equal(el.tagName.toLowerCase(), 'tr');
    assert.equal(el.childNodes.length, 2, 'should have td + comment marker');
  });
});
