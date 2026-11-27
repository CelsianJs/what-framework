// A Symbol given as a child renders nothing on the server, on the client and
// in hydration, as null does. In development it is reported as
// ERR_SYMBOL_CHILD, once for each component and Symbol on each path.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { h, mount, hydrate, flushSync, signal } = await import('../src/index.js');
const { __resetHydrationData } = await import('../src/hydration-data.js');
const { clearDiagnostics, getDiagnostics } = await import('../src/diagnostics.js');
const server = await import('../../server/src/index.js');

const SOURCE = `
  export const Status = (props) => <p>{props.status}</p>;
  export const Live = (props) => <p>{props.read()}</p>;
  export const Rows = (props) => <ul>{props.rows.map((row) => <li key={row.id}>{row.label}</li>)}</ul>;
`;
const client = await loadCompiled(SOURCE, { pluginOptions: { hydratable: true } });
const ssr = await loadCompiled(SOURCE, { pluginOptions: { generate: 'ssr' } });

const OPEN = Symbol('open');
const CLOSED = Symbol('closed');

function reports() {
  return getDiagnostics().events.filter((e) => e.code === 'ERR_SYMBOL_CHILD').map((e) => ({ ...e.data, count: e.count }));
}

function quietly(fn) {
  const { warn, error } = console;
  console.warn = console.error = () => {};
  try { return fn(); } finally { console.warn = warn; console.error = error; }
}

function host(html = '') {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.textContent = '';
  __resetHydrationData();
  clearDiagnostics();
});

describe('a Symbol child is reported in development', () => {
  it('compiled JSX on the client, once for each component and Symbol', () => {
    const el = host();
    quietly(() => {
      mount(h(client.Status, { status: OPEN }), el);
      mount(h(client.Status, { status: OPEN }), host());
      mount(h(client.Status, { status: CLOSED }), host());
    });
    assert.equal(el.textContent, '');
    assert.deepEqual(reports(), [
      { symbol: 'Symbol(open)', component: 'Status', path: 'client', count: 2 },
      { symbol: 'Symbol(closed)', component: 'Status', path: 'client', count: 1 },
    ]);
  });

  it('a reactive child that becomes a Symbol', () => {
    const value = signal('text');
    const el = host();
    quietly(() => {
      mount(h(client.Live, { read: value }), el);
      value(OPEN);
      flushSync();
    });
    assert.equal(el.textContent, '');
    assert.deepEqual(reports().map((r) => [r.component, r.path]), [['Live', 'client']]);
  });

  it('an h() child, given or returned by a function child', () => {
    const el = host();
    function Card() {
      return h('div', null, h('p', null, OPEN), h('p', null, () => CLOSED));
    }
    quietly(() => mount(h(Card), el));
    assert.equal(el.textContent, '');
    assert.deepEqual(reports().map((r) => [r.symbol, r.component, r.path]), [
      ['Symbol(open)', 'Card', 'client'],
      ['Symbol(closed)', 'Card', 'client'],
    ]);
  });

  it('a keyed row\'s field', () => {
    const el = host();
    quietly(() => mount(h(client.Rows, { rows: [{ id: 1, label: OPEN }] }), el));
    assert.equal(el.textContent, '');
    assert.deepEqual(reports().map((r) => r.symbol), ['Symbol(open)']);
  });

  it('on the server, and in hydration', () => {
    const html = quietly(() => server.renderToHydratableString(h(ssr.Status, { status: OPEN })));
    assert.equal(html.replace(/<!--[^>]*-->/g, '').replace(/ data-hk="[^"]*"/g, ''), '<p></p>');
    assert.deepEqual(reports().map((r) => [r.component, r.path]), [['Status', 'server']]);
    clearDiagnostics();
    const el = host(html);
    quietly(() => hydrate(h(client.Status, { status: OPEN }), el));
    assert.equal(el.textContent, '');
    assert.deepEqual(reports().map((r) => [r.component, r.path]), [['Status', 'hydration']]);
  });

  it('an h() tree on the server', () => {
    function Card() {
      return h('p', null, OPEN, () => CLOSED);
    }
    const html = quietly(() => server.renderToString(h(Card)));
    assert.equal(html, '<p></p>');
    assert.deepEqual(reports().map((r) => [r.symbol, r.path]), [['Symbol(open)', 'server'], ['Symbol(closed)', 'server']]);
  });

  it('prints the code once', () => {
    const lines = [];
    const { warn, error } = console;
    console.warn = console.error = (...args) => lines.push(args.join(' '));
    try {
      mount(h(client.Status, { status: OPEN }), host());
      mount(h(client.Status, { status: OPEN }), host());
    } finally {
      console.warn = warn;
      console.error = error;
    }
    assert.equal(lines.filter((l) => l.includes('ERR_SYMBOL_CHILD')).length, 1, lines.join('\n'));
  });
});
