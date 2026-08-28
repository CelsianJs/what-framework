// The runtime half of packages/compiler/test/conditional-list-teardown.test.js.
//
// A reactive region records the nodes its value produced and reuses that record
// as the removal set on the next run. For content the region built itself the
// record stays true, because nothing else touches those nodes. A mapArray list
// embedded in the value is not such content: it owns an effect of its own and
// goes on inserting and removing rows for as long as it is mounted, so the
// record describes the list as it was at mount and not as it is at teardown.
//
// Switching the region off then removed the rows that happened to be in the
// record and left every later one in the DOM, where the next switch back on
// rendered a second, complete list beside the orphans.
//
// Both entry points are covered because both feed the same reconciler: insert()
// is what the compiler emits for `{() => ...}`, and createDOM's reactive-child
// branch is what h() builds for the same expression.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { signal, flushSync } = await import('../src/reactive.js');
const { mapArray, insert, hydrate } = await import('../src/render.js');
const { h, Fragment } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');
const { renderToString } = await import('what-server');

function li(text) {
  const el = document.createElement('li');
  el.textContent = text;
  return el;
}

function tail() {
  const el = document.createElement('p');
  el.textContent = 'z';
  return el;
}

const strip = (el) => el.innerHTML.replace(/<!--.*?-->/g, '');

describe('a reactive region holding a list, torn down after the list grew', () => {
  it('insert(): removes rows the list appended after mount', () => {
    const show = signal(true);
    const items = signal(['a', 'b']);
    const el = document.createElement('div');
    // What the compiler emits for `{() => show() && <>{list}<p>z</p></>}`: a
    // fragment lowers to an array, so the region's value holds the list
    // inserter alongside an ordinary node.
    insert(el, () => show() && [mapArray(items, (i) => li(i), { key: (i) => i, raw: true }), tail()]);
    flushSync();
    assert.equal(strip(el), '<li>a</li><li>b</li><p>z</p>');

    items(['a', 'b', 'c']);
    flushSync();
    assert.equal(strip(el), '<li>a</li><li>b</li><li>c</li><p>z</p>');

    show(false);
    flushSync();
    assert.equal(strip(el), '', 'the region is off, so none of its rows may remain');

    show(true);
    flushSync();
    assert.equal(strip(el), '<li>a</li><li>b</li><li>c</li><p>z</p>');
  });

  it('insert(): removes rows an unkeyed list replaced after mount', () => {
    const show = signal(true);
    const items = signal(['a', 'b']);
    const el = document.createElement('div');
    insert(el, () => show() && [mapArray(items, (i) => li(i)), tail()]);
    flushSync();
    assert.equal(strip(el), '<li>a</li><li>b</li><p>z</p>');

    items(['a', 'b', 'c']);
    flushSync();
    show(false);
    flushSync();
    assert.equal(strip(el), '');
  });

  it('h(): removes rows the list appended after mount', () => {
    const show = signal(true);
    const items = signal(['a', 'b']);
    const container = document.getElementById('app');
    container.textContent = '';
    mount(
      h('div', null, () => show() && [
        mapArray(items, (i) => li(i), { key: (i) => i, raw: true }),
        h(Fragment, null, h('p', null, 'z')),
      ]),
      container,
    );
    flushSync();
    const el = container.querySelector('div');
    assert.equal(strip(el), '<li>a</li><li>b</li><p>z</p>');

    items(['a', 'b', 'c']);
    flushSync();
    assert.equal(strip(el), '<li>a</li><li>b</li><li>c</li><p>z</p>');

    show(false);
    flushSync();
    assert.equal(strip(el), '');

    show(true);
    flushSync();
    assert.equal(strip(el), '<li>a</li><li>b</li><li>c</li><p>z</p>');
  });

  // Hydration reaches the same reconciler by a different road: the region takes
  // ownership of whatever the server sent between its markers, and the list
  // takes over the rows from there. The record is a snapshot on this path too,
  // so it went stale the first time the list grew after the page came alive —
  // which is every list a user can add to.
  it('hydrate(): removes rows the list appended after hydration', () => {
    const show = signal(true);
    const items = signal(['a', 'b']);
    const container = document.getElementById('app');
    container.textContent = '';

    // The server renders through h() over a plain array; the compiled client
    // bundle brings a mapArray inserter. That pairing is the ordinary one.
    container.innerHTML = renderToString(
      h('ul', {}, () => show() && items().map((t) => h('li', {}, t))),
    );
    const el = () => container.querySelector('ul');
    assert.equal(strip(el()), '<li>a</li><li>b</li>');

    hydrate(
      h('ul', {}, () => show() && mapArray(items, (i) => li(i), { key: (i) => i, raw: true })),
      container,
    );
    flushSync();
    assert.equal(strip(el()), '<li>a</li><li>b</li>');

    items(['a', 'b', 'c']);
    flushSync();
    assert.equal(strip(el()), '<li>a</li><li>b</li><li>c</li>');

    show(false);
    flushSync();
    assert.equal(strip(el()), '');

    show(true);
    flushSync();
    assert.equal(strip(el()), '<li>a</li><li>b</li><li>c</li>');
  });

  // A row left behind by a partial teardown is still wired to a live list, so a
  // later write to the source moves it. That is the failure mode the markup
  // assertions can miss when a leftover row happens to match what the next
  // render would have produced anyway.
  it('leaves no live list behind that a later write can drive', () => {
    const show = signal(true);
    const items = signal(['a', 'b']);
    const el = document.createElement('div');
    insert(el, () => show() && [mapArray(items, (i) => li(i), { key: (i) => i, raw: true }), tail()]);
    flushSync();

    items(['a', 'b', 'c']);
    flushSync();
    show(false);
    flushSync();

    items(['c', 'b', 'a']);
    flushSync();
    assert.equal(strip(el), '');
  });
});
