// A reactive region must keep its POSITION and stay alive after hydration.
//
// The client render path wraps every reactive function child in `<!--fn-->` /
// `<!--/fn-->` comment markers. The hydration path created none, and that cost
// two things the moment anything updated:
//
//   1. reconcileInsert was called with a null marker, so it had no insertion
//      point and appended to the end of the parent. A <Show> that flipped arms
//      teleported to the bottom of its container. (A component realizes to a
//      DocumentFragment, and fragments deliberately skip the replace-in-place
//      fast path, so this hit every component-valued region.)
//   2. the effect's disposer was attached to the CONTENT node, so removing that
//      content disposed the effect. The region then never updated again.
//
// Net effect: a server-rendered <Show> broke its layout on the first toggle and
// stopped responding on the second. Client-only rendering was always correct,
// which is why no existing test saw it: the bug needed SSR + hydration + a
// toggle, and the suite covered each of those separately.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const { signal, flushSync } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { hydrate } = await import('../src/render.js');
const { mount } = await import('../src/dom.js');
const { Show } = await import('../src/components.js');
const { onCleanup } = await import('../src/hooks.js');
const { renderToString } = await import('what-server');

// <main> with a stable heading, a toggling region, and a stable trailing
// paragraph. The trailing sibling is the point: it is what makes a position
// regression observable at all.
function App(count) {
  return () => h('main', {},
    h('h1', {}, 'Cart'),
    h(Show, { when: () => count() > 0, fallback: h('p', { 'data-empty': '' }, 'Empty') },
      h('div', { 'data-table': '' }, 'Table'),
    ),
    h('p', { 'data-status': '' }, 'status'),
  );
}

function layout() {
  return [...document.querySelector('main').children]
    .map((el) => {
      if (el.dataset.empty !== undefined) return 'empty';
      if (el.dataset.table !== undefined) return 'table';
      if (el.dataset.status !== undefined) return 'status';
      return el.tagName.toLowerCase();
    })
    .join(' ');
}

/** SSR at `serverValue`, then hydrate a client sitting at `clientValue`. */
function boot(serverValue, clientValue) {
  const server = signal(serverValue);
  document.body.innerHTML = renderToString(h(App(server), {}));
  const client = signal(clientValue);
  hydrate(h(App(client), {}), document.body);
  flushSync();
  return client;
}

describe('a hydrated reactive region keeps its place in the DOM', () => {
  it('toggles in place when server and client agree at hydration', () => {
    const count = boot(0, 0);
    assert.equal(layout(), 'h1 empty status');

    count(1); flushSync();
    assert.equal(layout(), 'h1 table status', 'the region must stay between h1 and status');

    count(0); flushSync();
    assert.equal(layout(), 'h1 empty status');
  });

  it('keeps toggling indefinitely, not just once', () => {
    const count = boot(0, 0);
    for (let i = 0; i < 4; i++) {
      count(1); flushSync();
      assert.equal(layout(), 'h1 table status', `cycle ${i}: failed to show content`);
      count(0); flushSync();
      assert.equal(layout(), 'h1 empty status', `cycle ${i}: failed to return to fallback`);
    }
  });

  it('toggles in place when the client starts on the other arm', () => {
    // The realistic case: the server cannot see localStorage, so it renders the
    // empty cart and the client immediately knows better.
    const count = boot(0, 1);
    assert.equal(layout(), 'h1 table status', 'hydration must adopt the client arm, in position');

    count(0); flushSync();
    assert.equal(layout(), 'h1 empty status');

    count(1); flushSync();
    assert.equal(layout(), 'h1 table status');
  });

  it('bounds the region with markers so following siblings are untouched', () => {
    const count = boot(0, 0);
    const status = document.querySelector('[data-status]');
    count(1); flushSync();
    count(0); flushSync();
    assert.equal(document.querySelector('[data-status]'), status,
      'the sibling after the region must never be recreated or moved');
  });
});

describe('nested reactive regions nest, rather than interleave', () => {
  // Hydration claims the inner content first, so the inner region's markers went
  // in first; anchoring the outer markers to the CONTENT node then put the outer
  // start marker INSIDE the inner pair. The regions interleaved, and switching
  // the outer arm removed the visible content but neither the inner markers nor
  // the inner effect. The orphaned effect kept rendering into a region that was
  // switched off, and its output came back doubled when the outer arm returned.
  //
  // <Show> wrapping <Show> or <For> is the canonical shape, not an exotic one.
  //
  // The assertion is PARITY with a client-only render of the same tree, which is
  // the standard hydration has to meet and the only one that stays honest if the
  // control-flow semantics themselves ever change.
  const Nested = (outer, inner) => () => h('div', { id: 'root' },
    h(Show, { when: outer },
      h(Show, { when: inner, fallback: h('em', {}, 'NO') }, h('p', {}, 'YES'))),
    h('hr', {}),
  );

  function toggleSequence(outer, inner) {
    const text = () => document.querySelector('#root').textContent.trim();
    const seen = [text()];
    for (const [sig, value] of [[outer, false], [inner, false], [outer, true], [inner, true]]) {
      sig(value);
      flushSync();
      seen.push(text());
    }
    return seen;
  }

  it('behaves exactly like a client-only render of the same tree', () => {
    const serverOuter = signal(true);
    const serverInner = signal(true);
    document.body.innerHTML = renderToString(h(Nested(serverOuter, serverInner), {}));

    const hydratedOuter = signal(true);
    const hydratedInner = signal(true);
    hydrate(h(Nested(hydratedOuter, hydratedInner), {}), document.body);
    flushSync();
    const hydrated = toggleSequence(hydratedOuter, hydratedInner);

    document.body.innerHTML = '<div id="host"></div>';
    const clientOuter = signal(true);
    const clientInner = signal(true);
    mount(h(Nested(clientOuter, clientInner), {}), '#host');
    flushSync();
    const clientOnly = toggleSequence(clientOuter, clientInner);

    assert.deepEqual(hydrated, clientOnly,
      'a hydrated tree must behave identically to the same tree rendered on the client');
  });

  it('does not leave the inner region rendering while the outer arm is off', () => {
    // The specific symptom: with the outer arm off, flipping the INNER signal
    // used to paint the inner fallback into a region nobody is showing.
    const serverOuter = signal(true);
    const serverInner = signal(true);
    document.body.innerHTML = renderToString(h(Nested(serverOuter, serverInner), {}));

    const outer = signal(true);
    const inner = signal(true);
    hydrate(h(Nested(outer, inner), {}), document.body);
    flushSync();

    outer(false);
    flushSync();
    assert.equal(document.querySelector('#root').textContent.trim(), '');

    inner(false);
    flushSync();
    assert.equal(document.querySelector('#root').textContent.trim(), '',
      'the inner region must not render while the outer arm is off');
  });
});

describe('a region that renders nothing still knows where it lives', () => {
  // `{() => flag() && <Box/>}` with the flag false on the server produces NO
  // node, so there is nothing to place markers around. Appending them put the
  // region after every remaining sibling, and the content appeared at the bottom
  // of its parent the moment the flag flipped: permanently, and with no warning.
  // This is the same class as the <Show> bug above but the branch that <Show>
  // never reaches, because a <Show> with a fallback always produces a node.
  function Falsy(flag) {
    return () => h('main', {},
      h('h1', {}, 'Title'),
      () => (flag() ? h('div', { 'data-box': '' }, 'Box') : null),
      h('p', { 'data-after': '' }, 'after'),
    );
  }

  function order() {
    return [...document.querySelector('main').children]
      .map((el) => (el.dataset.box !== undefined ? 'box' : el.tagName.toLowerCase()))
      .join(' ');
  }

  it('inserts falsy-region content in position, not at the end of the parent', () => {
    const server = signal(false);
    document.body.innerHTML = renderToString(h(Falsy(server), {}));
    assert.equal(order(), 'h1 p', 'the server renders nothing for the region');

    const client = signal(false);
    hydrate(h(Falsy(client), {}), document.body);
    flushSync();

    client(true); flushSync();
    assert.equal(order(), 'h1 box p', 'the box belongs between the heading and the paragraph');

    client(false); flushSync();
    assert.equal(order(), 'h1 p');

    client(true); flushSync();
    assert.equal(order(), 'h1 box p', 'and stays there on every later toggle');
  });

  it('keeps the following sibling identical across the toggle', () => {
    const server = signal(false);
    document.body.innerHTML = renderToString(h(Falsy(server), {}));
    const after = document.querySelector('[data-after]');

    const client = signal(false);
    hydrate(h(Falsy(client), {}), document.body);
    flushSync();
    client(true); flushSync();

    assert.equal(document.querySelector('[data-after]'), after,
      'the sibling after the region must never be recreated');
  });
});

describe('empty reactive text is not a hydration mismatch', () => {
  it('does not warn when a reactive child renders an empty string', () => {
    // HTML cannot serialize an empty text node, so the server emitting nothing
    // is the only possible correct output. Warning here fired on the most
    // ordinary conditional there is and taught developers to tune the warnings
    // out.
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const message = signal('');
      const Page = (msg) => () => h('div', {},
        h('span', { 'data-msg': '' }, () => msg()),
        h('b', { 'data-after': '' }, 'AFTER'),
      );

      document.body.innerHTML = renderToString(h(Page(message), {}));
      const clientMessage = signal('');
      hydrate(h(Page(clientMessage), {}), document.body);
      flushSync();

      assert.deepEqual(warnings.filter((w) => /Hydration mismatch/.test(w)), []);

      // And it must still become reactive.
      clientMessage('now something');
      flushSync();
      assert.equal(document.querySelector('[data-msg]').textContent, 'now something');
      assert.equal(document.querySelector('[data-after]').textContent, 'AFTER');
    } finally {
      console.warn = originalWarn;
    }
  });

  it('does not consume a sibling when the empty text has one after it', () => {
    // The destructive shape. An empty string used to claim the next node, find
    // an ELEMENT where it wanted text, and replaceChild it away: the server's
    // real markup was destroyed, every following sibling shifted, and a
    // warn-and-recreate cascaded through the rest of the parent. Any DOM state
    // on those nodes (a typed-into input, an open details, a scroll position)
    // went with it.
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const App = (msg) => () => h('main', {},
        h('b', { 'data-before': '' }, 'BEFORE'),
        () => msg(),
        h('p', { 'data-after': '' }, 'AFTER'),
      );

      const server = signal('');
      document.body.innerHTML = renderToString(h(App(server), {}));
      const before = document.querySelector('[data-before]');
      const after = document.querySelector('[data-after]');

      const client = signal('');
      hydrate(h(App(client), {}), document.body);
      flushSync();

      assert.equal(document.querySelector('[data-before]'), before, 'the preceding sibling survives');
      assert.equal(document.querySelector('[data-after]'), after, 'the following sibling survives');
      assert.deepEqual(warnings.filter((w) => /Hydration mismatch/.test(w)), []);

      client('now something');
      flushSync();
      assert.equal(document.querySelector('[data-after]'), after,
        'and still survives once the region fills in');
      assert.match(document.querySelector('main').textContent, /BEFOREnow somethingAFTER/);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('clears text the server rendered when the client value is empty', () => {
    // The other half of the same decision, and the one the first version of the
    // fix broke. Refusing to claim ANYTHING for an empty value left the server's
    // text on screen with the region's own empty node sitting beside it. The
    // stale value never went away, and the next value rendered ALONGSIDE it
    // rather than replacing it: "9 items3 items".
    //
    // This is the ordinary case, not an edge: a count restored from
    // localStorage, a signed-out user where the server assumed signed-in, any
    // value the server guesses and the client corrects to nothing.
    const App = (msg) => () => h('main', {},
      h('b', { 'data-before': '' }, 'BEFORE'),
      () => msg(),
      h('p', { 'data-after': '' }, 'AFTER'),
    );

    const server = signal('9 items');
    document.body.innerHTML = renderToString(h(App(server), {}));
    assert.match(document.querySelector('main').textContent, /9 items/, 'the server rendered a value');
    const after = document.querySelector('[data-after]');

    const client = signal('');
    hydrate(h(App(client), {}), document.body);
    flushSync();

    assert.equal(document.querySelector('main').textContent, 'BEFOREAFTER',
      "the server's text must be cleared, not left on screen");
    assert.equal(document.querySelector('[data-after]'), after, 'without disturbing the sibling');

    client('3 items');
    flushSync();
    assert.equal(document.querySelector('main').textContent, 'BEFORE3 itemsAFTER',
      'and the next value replaces it rather than joining it');
  });
});

describe('a region owns content it had to create itself', () => {
  // When the server rendered nothing for a region and the client renders
  // something, the content is created rather than claimed. It used to be
  // APPENDED to the end of the parent while the cursor stayed put, so the end
  // marker was then inserted BEFORE it. The region owned nothing between its
  // markers and could never take the content back: switching the condition off
  // left it on screen permanently, with no warning and no way to recover.
  //
  // The falsy-region tests above cannot reach this: they have a trailing sibling
  // for the content to displace, so the create path lands inside the markers by
  // accident. The bug needs the region to be the LAST thing in its parent.
  function Trailing(flag) {
    return () => h('main', {},
      h('h1', {}, 'Title'),
      () => (flag() ? h('div', { 'data-box': '' }, 'Box') : null),
    );
  }

  it('can remove content it created during hydration', () => {
    const server = signal(false);
    document.body.innerHTML = renderToString(h(Trailing(server), {}));
    assert.equal(document.querySelector('[data-box]'), null, 'the server renders nothing');

    const client = signal(true);
    hydrate(h(Trailing(client), {}), document.body);
    flushSync();
    assert.ok(document.querySelector('[data-box]'), 'the client fills the region in');

    client(false);
    flushSync();
    assert.equal(document.querySelector('[data-box]'), null,
      'and must be able to take it back out again');

    client(true);
    flushSync();
    assert.ok(document.querySelector('[data-box]'), 'and put it back');
    assert.equal(document.querySelectorAll('[data-box]').length, 1, 'exactly once');
  });
});

describe('a component whose root is a reactive region survives its first update', () => {
  // Hydration has no comment markers for a COMPONENT, so its context is anchored
  // to a DOM node in order to be reachable for disposal. Anchoring to the node
  // the component produced is only safe when that node is stable, and the root
  // of a <Show>-style component is precisely the node its own region replaces.
  //
  // The first toggle therefore disposed the component that owns the toggle:
  // every effect, cleanup and onCleanup it registered died while it was still
  // mounted. A hydrated component that polls, subscribes, or holds a query went
  // silent the first time its own root re-rendered.
  it('does not dispose its own context when the region updates', () => {
    let cleanups = 0;
    const Panel = ({ flag }) => {
      onCleanup(() => { cleanups++; });
      return () => (flag() ? h('div', { 'data-on': '' }, 'ON') : h('div', { 'data-off': '' }, 'OFF'));
    };

    const serverFlag = signal(true);
    document.body.innerHTML = renderToString(h('section', {}, h(Panel, { flag: serverFlag })));

    const flag = signal(true);
    hydrate(h('section', {}, h(Panel, { flag })), document.body);
    flushSync();
    assert.equal(cleanups, 0, 'nothing is disposed at hydration');

    flag(false);
    flushSync();
    assert.ok(document.querySelector('[data-off]'), 'the region updates');
    assert.equal(cleanups, 0,
      'the component must not dispose itself when its own root region updates');

    flag(true);
    flushSync();
    assert.ok(document.querySelector('[data-on]'), 'and keeps updating');
    assert.equal(cleanups, 0);
  });
});
