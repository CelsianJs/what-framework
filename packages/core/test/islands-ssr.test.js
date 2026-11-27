// Regressions for the islands defects found in the 2026-08-09 parity audit.
//
// `client:*` used to render an empty marker div on EVERY path: the SSR branch
// never rendered the component, and the client branch read `hydrated()` once in
// a run-once component so the swap-in never happened. Every island directive
// silently deleted its own component, which is strictly worse than not using the
// directive at all.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM();

const W = await import('../src/index.js');
const { h, mount, hydrate, signal } = W;
// What a client:* directive compiles to; h() code calls it the same way.
const { _$Island: Island } = await import('../src/render.js');
const { renderToString, renderToHydratableString: renderHydratable } = await import('../../server/src/index.js');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const app = () => document.getElementById('app');

function Counter({ start = 0, label = 'count' }) {
  const n = signal(start, 'n');
  return h('button', { onclick: () => n((v) => v + 1) }, () => `${label} ${n()}`);
}

describe('islands render their content on the server', () => {
  beforeEach(() => { app().innerHTML = ''; });

  it('ships the component HTML inside the marker, not an empty div', () => {
    const html = renderToString(h(Island, { component: Counter, name: 'Counter', mode: 'idle', start: 7 }));
    assert.match(html, /<button[^>]*>count 7<\/button>/, 'the island content must be server-rendered');
    assert.match(html, /data-island="Counter"/);
    assert.match(html, /data-island-mode="idle"/);
  });

  it('renders the same content the undirected component would', () => {
    const withDirective = renderToString(h(Island, { component: Counter, name: 'Counter', mode: 'load', start: 3 }));
    const without = renderToString(h(Counter, { start: 3 }));
    assert.ok(withDirective.includes(without), 'the directive must not change the rendered output');
  });

  it('serializes props onto the marker for the client', () => {
    const html = renderToString(h(Island, { component: Counter, name: 'Counter', mode: 'idle', start: 2, label: 'hits' }));
    const props = JSON.parse(html.match(/data-island-props="([^"]*)"/)[1].replace(/&quot;/g, '"'));
    assert.deepEqual(props, { start: 2, label: 'hits' });
  });

  it('takes the component\'s props apart from its options under `props`, where any name is a prop', () => {
    const Card = (p) => h('b', {}, `${p.name}|${p.mode}|${p.component}|${p.mediaQuery}`);
    const html = renderToString(h(Island, {
      component: Card, name: 'Ticket', mode: 'idle',
      props: { name: 'Ada', mode: 'dark', component: 'fieldset', mediaQuery: 'print' },
    }));
    assert.match(html, /data-island="Ticket" data-island-mode="idle"/);
    assert.match(html, /<b>Ada\|dark\|fieldset\|print<\/b>/);
    const props = JSON.parse(html.match(/data-island-props="([^"]*)"/)[1].replace(/&quot;/g, '"'));
    assert.deepEqual(props, { name: 'Ada', mode: 'dark', component: 'fieldset', mediaQuery: 'print' });
  });

  it('drops non-serializable props instead of throwing mid-render', () => {
    const html = renderToString(
      h(Island, { component: Counter, name: 'Counter', mode: 'idle', start: 1, onSelect: () => {}, missing: undefined })
    );
    const props = JSON.parse(html.match(/data-island-props="([^"]*)"/)[1].replace(/&quot;/g, '"'));
    assert.deepEqual(props, { start: 1 }, 'functions and undefined are not transferable');
    assert.match(html, /count 1<\/button>/, 'the island still renders');
  });

  it('renders island children', () => {
    const Panel = ({ children }) => h('section', {}, children);
    const html = renderToString(h(Island, { component: Panel, name: 'Panel', mode: 'idle' }, h('p', {}, 'inner')));
    assert.match(html, /<section><p>inner<\/p><\/section>/);
  });
});

// A minifier renames an island's function in one bundle and not the other,
// so only a `name` given to it is the same on the server and in the browser.
describe('an island written by hand without a name', () => {
  it('is reported in development, once per component; one with a name is not', () => {
    const warn = console.warn;
    console.warn = () => {};
    W.clearDiagnostics();
    try {
      function Gauge() { return h('meter', { value: 1 }); }
      assert.match(renderToString(h(Island, { component: Gauge, mode: 'idle' })), /data-island="Gauge"/, 'named after its function');
      renderToString(h(Island, { component: Gauge, mode: 'load' }));
      renderToString(h(Island, { component: Counter, name: 'Counter', mode: 'idle' }));
      mount(h(Island, { component: Counter, name: 'Counter', mode: 'static' }), app());
    } finally {
      console.warn = warn;
    }
    const reported = W.getDiagnostics().events.filter((e) => e.code === 'ERR_ISLAND_WITHOUT_NAME');
    assert.deepEqual(reported.map((e) => [e.data.component, e.count]), [['Gauge', 2]]);
    assert.match(reported[0].message, /Island <Gauge> has no `name`/);
  });
});

describe('islands hydrate on the client', () => {
  beforeEach(() => { app().innerHTML = ''; });

  it('renders the component after the trigger fires in a client-only render', async () => {
    mount(h(Island, { component: Counter, name: 'Counter', mode: 'load', start: 5 }), '#app');
    assert.equal(app().querySelector('button'), null, 'nothing before the trigger');
    await tick();
    assert.match(app().querySelector('button').textContent, /count 5/);
  });

  it('reuses the server DOM instead of rebuilding it, and becomes interactive', async () => {
    app().innerHTML = renderToString(h(Island, { component: Counter, name: 'Counter', mode: 'load', start: 7 }));
    const serverButton = app().querySelector('button');

    hydrate(h(Island, { component: Counter, name: 'Counter', mode: 'load', start: 7 }), app());
    await tick();

    const buttons = app().querySelectorAll('button');
    assert.equal(buttons.length, 1, 'hydration must not double-render the island');
    assert.equal(buttons[0], serverButton, 'the server-rendered node must be reused, not replaced');

    buttons[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await tick(10);
    assert.match(app().querySelector('button').textContent, /count 8/, 'the island must be interactive');
  });

  it('marks itself hydrated and announces it', async () => {
    let announced = null;
    app().addEventListener('island:hydrated', (e) => { announced = e.detail; });
    mount(h(Island, { component: Counter, name: 'Counter', mode: 'load' }), '#app');
    await tick();

    const el = app().querySelector('[data-island]');
    assert.ok(el.hasAttribute('data-island-hydrated'));
    assert.equal(el.hasAttribute('data-hydrate'), false, 'the pending marker is cleared');
    assert.deepEqual(announced, { name: 'Counter', mode: 'load' });
  });

  it('mode "static" ships the HTML and never hydrates', async () => {
    app().innerHTML = renderToString(h(Island, { component: Counter, name: 'Counter', mode: 'static', start: 4 }));
    assert.match(app().innerHTML, /count 4/, 'static islands still render on the server');

    hydrate(h(Island, { component: Counter, name: 'Counter', mode: 'static', start: 4 }), app());
    await tick(50);

    const el = app().querySelector('[data-island]');
    assert.equal(el.hasAttribute('data-island-hydrated'), false, 'static means no JS attaches');
    app().querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await tick(10);
    assert.match(app().querySelector('button').textContent, /count 4/, 'still inert after a click');
  });

  it('mode "interaction" waits for the user before hydrating', async () => {
    app().innerHTML = renderToString(h(Island, { component: Counter, name: 'Counter', mode: 'interaction', start: 1 }));
    hydrate(h(Island, { component: Counter, name: 'Counter', mode: 'interaction', start: 1 }), app());
    await tick();

    const el = app().querySelector('[data-island]');
    assert.equal(el.hasAttribute('data-island-hydrated'), false, 'no hydration without interaction');

    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await tick();
    assert.ok(el.hasAttribute('data-island-hydrated'), 'the interaction triggers hydration');
  });

  it('mode "interaction": focusing a control inside it (focus does not bubble) hydrates it, also under <Suspense>', () => {
    const { Suspense } = W;
    const tree = () => h(Suspense, { fallback: 'loading' }, h(Island, { component: Counter, name: 'Counter', mode: 'interaction', start: 1 }));
    app().innerHTML = renderHydratable(tree());
    const stop = hydrate(tree(), app());
    const el = app().querySelector('[data-island]');
    const button = el.querySelector('button');
    assert.equal(el.hasAttribute('data-island-hydrated'), false);
    button.focus();
    assert.equal(document.activeElement, button);
    assert.ok(el.hasAttribute('data-island-hydrated'), 'keyboard focus hydrates the island');
    assert.equal(el.querySelector('button'), button, 'the server button is kept');
    stop();
  });

  it('mode "interaction": the click that hydrates it reaches the handler it sets, and the handler goes with the island', () => {
    let clicks = 0;
    const Save = () => h('button', { onclick: () => { clicks++; } }, 'save');
    const tree = () => h(W.Suspense, { fallback: 'loading' }, h(Island, { component: Save, name: 'Save', mode: 'interaction' }));
    app().innerHTML = renderHydratable(tree());
    const stop = hydrate(tree(), app());
    const button = app().querySelector('button');
    button.click();
    assert.equal(clicks, 1, 'the first click ran the handler');
    assert.equal(app().querySelector('button'), button);
    button.click();
    assert.equal(clicks, 2);
    stop();
    button.click();
    assert.equal(clicks, 2, 'unmounted: the handler is gone');
  });
});

describe('refs fire on the hydration path', () => {
  // hydrateElementProps skipped `ref` outright, so any component that reached for
  // its own DOM node got nothing under SSR while working fine client-only. The
  // island scheduler depends on this, but so does every ref-using component.
  beforeEach(() => { app().innerHTML = ''; });

  it('calls a ref callback with the hydrated element', () => {
    app().innerHTML = '<div><span>hi</span></div>';
    const existing = app().querySelector('span');
    let got = null;
    hydrate(h('div', {}, h('span', { ref: (el) => { got = el; } }, 'hi')), app());
    assert.equal(got, existing, 'the ref must receive the reused server node');
  });

  it('fills a ref object with the hydrated element', () => {
    app().innerHTML = '<p>x</p>';
    const ref = { current: null };
    hydrate(h('p', { ref }, 'x'), app());
    assert.equal(ref.current, app().querySelector('p'));
  });
});
