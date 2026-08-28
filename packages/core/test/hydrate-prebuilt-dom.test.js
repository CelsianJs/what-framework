// hydrate() of an already-built DOM tree must not blank the page.
//
// hydrateNode's DOM-node branch returned the node without inserting it and
// without claiming anything, so hydrate()'s own trimUnclaimed then deleted every
// server child it found: an empty container, a dead button, and no warning at
// all.
//
// That branch is not an exotic path. Compiled JSX makes it the NATURAL spelling
// of a hydrate root, because the compiler lowers `hydrate(<App />)` to
// `hydrate(_$createComponent(App, ...))`, which has already run the component
// and built its DOM. An app following the SSR guide with what-compiler on the
// client got a blank page.
//
// The fix is a client render, not real hydration: a built node's bindings are
// already wired to itself, so it cannot adopt the server's markup. What these
// tests pin is that the page ends up CORRECT and INTERACTIVE, that the loss of
// reuse is announced once, and that the h() path still reuses server nodes (the
// fallback must not have quietly become the only path).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM();
globalThis.__WHAT_DEV__ = true;

const { signal, flushSync } = await import('../src/reactive.js');
const { _$template, insert, _$createComponent, hydrate, delegateEvents } = await import('../src/render.js');
const { h } = await import('../src/h.js');

delegateEvents(['click']);

const tmplH1 = _$template('<h1>Count: <!--$--></h1>');
const tmplBtn = _$template('<button>inc</button>');
const tmplP = _$template('<p>even</p>');

const SERVER_HTML = '<h1>Count: 0</h1><button>inc</button><p>even</p>';

// The same page in both dialects. The client starts at 5, which the server could
// not have known, so a correct hydrate has to show 5 and an odd count hides <p>.
function compiledApp(count) {
  return function App() {
    const heading = tmplH1();
    insert(heading, () => count(), heading.firstChild.nextSibling);
    const button = tmplBtn();
    button.$$click = () => count(count() + 1);
    return [heading, button, () => count() % 2 === 0 && tmplP()];
  };
}

function hApp(count) {
  return function App() {
    return [
      h('h1', null, 'Count: ', () => count()),
      h('button', { onClick: () => count(count() + 1) }, 'inc'),
      () => count() % 2 === 0 && h('p', null, 'even'),
    ];
  };
}

let warnings;
let realWarn;

beforeEach(() => {
  document.body.innerHTML = `<div id="app">${SERVER_HTML}</div>`;
  warnings = [];
  realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
});

afterEach(() => {
  console.warn = realWarn;
});

function click(root) {
  root.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  flushSync();
}

describe('hydrate() of already-built DOM', () => {
  it('renders and stays interactive instead of emptying the container', () => {
    const app = document.getElementById('app');
    hydrate(_$createComponent(compiledApp(signal(5)), null, []), app);
    flushSync();

    assert.equal(app.textContent, 'Count: 5inc');
    click(app);
    assert.equal(app.textContent, 'Count: 6inceven');
  });

  it('warns once, not once per node', () => {
    hydrate(_$createComponent(compiledApp(signal(5)), null, []), document.getElementById('app'));
    flushSync();

    assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}`);
    assert.match(warnings[0], /already built/);
  });

  it('replaces the server node rather than doubling it in <body>', () => {
    // <body> is the one container trimUnclaimed refuses to tidy, because it also
    // holds the scripts and the hydration payload. Without claiming the node it
    // displaces, the client render simply stacked on top of the server's copy.
    document.body.innerHTML = '<h1>Count: 0</h1><script id="payload"></script>';
    hydrate(_$createComponent(function App() {
      const heading = tmplH1();
      insert(heading, () => '5', heading.firstChild.nextSibling);
      return heading;
    }, null, []), document.body);
    flushSync();

    assert.equal(document.body.querySelectorAll('h1').length, 1);
    assert.equal(document.body.querySelector('h1').textContent, 'Count: 5');
    assert.ok(document.body.querySelector('script#payload'), 'the payload script must survive');
  });

  it('a compiled component reached through an h() root still renders', () => {
    document.body.innerHTML = '<div id="app"><h1>Count: 0</h1></div>';
    const app = document.getElementById('app');
    const count = signal(5);
    hydrate(h(function App() {
      const heading = tmplH1();
      insert(heading, () => count(), heading.firstChild.nextSibling);
      return heading;
    }, null), app);
    flushSync();

    assert.equal(app.textContent, 'Count: 5');
    count(6);
    flushSync();
    assert.equal(app.textContent, 'Count: 6');
  });

  // A control, and passing before the fix is the point: the client-render
  // fallback must stay confined to already-built input. If this one ever starts
  // taking the fallback, hydration has stopped hydrating for everybody.
  it('leaves the h() path adopting the server DOM, with no warning', () => {
    const app = document.getElementById('app');
    const serverHeading = app.querySelector('h1');
    hydrate(h(hApp(signal(5)), null), app);
    flushSync();

    assert.equal(app.querySelector('h1'), serverHeading, 'h() must still reuse the server node');
    assert.equal(app.textContent, 'Count: 5inc');
    assert.equal(
      warnings.filter((w) => /already built/.test(w)).length,
      0,
      'the h() path must not take the client-render fallback',
    );
    click(app);
    assert.equal(app.textContent, 'Count: 6inceven');
  });
});
