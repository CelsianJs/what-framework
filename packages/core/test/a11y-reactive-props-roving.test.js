// Regressions for the two a11y-helper defects found in the whatfw.com audit
// against the released 0.12.3.
//
//   #56 the ARIA prop helpers snapshot their state. `{...buttonProps()}` reads
//       the signal EAGERLY and hands the spread a frozen boolean, so an
//       accordion's aria-expanded never changes after mount. The spread form is
//       the documented one, so the documented path was the broken one.
//   #57 useRovingTabIndex never moved DOM focus (the entire point of the
//       WAI-ARIA pattern it is named after) and hard-coded role="listbox" on the
//       container, silently overriding a role the caller wrote before the spread.
//
// Both spread paths are exercised: h()/dom.js (setProp) and the compiled-JSX
// path (render.js spread(), which is what `{...props}` lowers to). The assertions
// are on the RENDERED attribute, never on the returned object, because ARIA
// values are enumerated strings and the boolean branch in dom.js used to turn
// `true` into `aria-checked=""`.
//
// The first repair of #57 located items with a `data-what-roving` group id
// allocated from the useId counter, and that broke under SSR + islands, which is
// the architecture What ships as a headline feature. hydrate() calls
// __resetIdCounter() on every invocation and islands hydrate one at a time, so
// a single island renumbered its group (focus stopped moving again) and two
// islands both computed group 1 (ArrowRight in one widget moved focus into the
// OTHER one). Those two cases are the load-bearing tests below, and both have to
// run through renderToString() + hydrate() to mean anything: a client-only mount
// cannot see either. Items are now held by ref, so no counter is involved.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.FocusEvent = dom.window.FocusEvent;
global.Node = dom.window.Node;
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const { h, mount, signal } = await import('../src/index.js');
const { spread, hydrate } = await import('../src/render.js');
const {
  useAriaExpanded,
  useAriaSelected,
  useAriaChecked,
  useRovingTabIndex,
  useId,
} = await import('../src/a11y.js');
const { renderToString } = await import('../../server/src/index.js');

const flush = () => new Promise((r) => setTimeout(r, 5));
const app = () => document.getElementById('app');

describe('#56 ARIA prop helpers stay reactive through a spread', () => {
  beforeEach(() => { app().innerHTML = ''; });

  it('useAriaExpanded: aria-expanded tracks the signal through h() spread', async () => {
    const { toggle, buttonProps } = useAriaExpanded(false);
    mount(h('button', { ...buttonProps() }, 'x'), '#app');
    const el = app().querySelector('button');

    assert.equal(el.getAttribute('aria-expanded'), 'false');
    toggle();
    await flush();
    assert.equal(el.getAttribute('aria-expanded'), 'true', 'spread froze aria-expanded at mount');
  });

  it('useAriaExpanded: aria-expanded tracks the signal through the compiled spread()', async () => {
    const { toggle, buttonProps } = useAriaExpanded(false);
    const el = document.createElement('button');
    app().appendChild(el);
    spread(el, buttonProps());

    assert.equal(el.getAttribute('aria-expanded'), 'false');
    toggle();
    await flush();
    assert.equal(el.getAttribute('aria-expanded'), 'true', 'compiled {...buttonProps()} froze aria-expanded');
  });

  it('useAriaExpanded: the click handler in buttonProps still toggles', async () => {
    const { expanded, buttonProps } = useAriaExpanded(false);
    mount(h('button', { ...buttonProps() }, 'x'), '#app');
    const el = app().querySelector('button');

    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await flush();
    assert.equal(expanded(), true);
    assert.equal(el.getAttribute('aria-expanded'), 'true');
  });

  it('useAriaExpanded: panelProps hidden tracks the signal', async () => {
    const { open, panelProps } = useAriaExpanded(false);
    mount(h('div', { id: 'panel', ...panelProps() }, 'body'), '#app');
    const el = app().querySelector('#panel');

    assert.equal(el.hasAttribute('hidden'), true, 'collapsed panel must start hidden');
    open();
    await flush();
    assert.equal(el.hasAttribute('hidden'), false, 'spread froze hidden at mount');
  });

  it('useAriaSelected: aria-selected tracks the signal on every item', async () => {
    const { select, itemProps } = useAriaSelected('a');
    mount(h('ul', {},
      h('li', { id: 'a', ...itemProps('a') }, 'A'),
      h('li', { id: 'b', ...itemProps('b') }, 'B'),
    ), '#app');
    const a = app().querySelector('#a');
    const b = app().querySelector('#b');

    assert.equal(a.getAttribute('aria-selected'), 'true');
    assert.equal(b.getAttribute('aria-selected'), 'false');
    select('b');
    await flush();
    assert.equal(a.getAttribute('aria-selected'), 'false', 'spread froze aria-selected at mount');
    assert.equal(b.getAttribute('aria-selected'), 'true', 'spread froze aria-selected at mount');
  });

  it('useAriaChecked: aria-checked tracks the signal and stays an enumerated string', async () => {
    const { toggle, checkboxProps } = useAriaChecked(false);
    mount(h('div', { ...checkboxProps() }, 'x'), '#app');
    const el = app().querySelector('[role=checkbox]');

    // "" (HTML boolean syntax) is not a valid enumerated ARIA value, and an
    // absent aria-checked means "unsupported" rather than "unchecked".
    assert.equal(el.getAttribute('aria-checked'), 'false');
    toggle();
    await flush();
    assert.equal(el.getAttribute('aria-checked'), 'true', 'spread froze aria-checked at mount');
    toggle();
    await flush();
    assert.equal(el.getAttribute('aria-checked'), 'false');
  });

  it('the helpers still server-render as enumerated strings', () => {
    const expandedApi = useAriaExpanded(true);
    const checkedApi = useAriaChecked(false);
    assert.match(renderToString(h('button', expandedApi.buttonProps(), 'x')), /aria-expanded="true"/);
    const checkedHtml = renderToString(h('div', checkedApi.checkboxProps(), 'x'));
    assert.match(checkedHtml, /aria-checked="false"/);
    assert.match(checkedHtml, /role="checkbox"/);
  });
});

describe('#57 useRovingTabIndex implements the roving tabindex pattern', () => {
  beforeEach(() => { app().innerHTML = ''; });

  function mountList(count = 3, api) {
    const roving = api || useRovingTabIndex(count);
    const items = [];
    for (let i = 0; i < count; i++) items.push(h('button', { id: `it${i}`, ...roving.getItemProps(i) }, `#${i}`));
    mount(h('div', { ...roving.containerProps() }, ...items), '#app');
    return { roving, el: (i) => app().querySelector(`#it${i}`) };
  }

  const arrow = (el, key) => el.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );

  it('moves real DOM focus to the next item on ArrowDown', async () => {
    const { roving, el } = mountList(3);
    el(0).focus();
    assert.equal(document.activeElement, el(0));

    arrow(el(0), 'ArrowDown');
    await flush();
    assert.equal(roving.focusIndex(), 1);
    assert.equal(document.activeElement, el(1), 'roving tabindex must MOVE focus, not only shuffle tabIndex');
  });

  it('wraps focus with ArrowUp from the first item and honours Home/End', async () => {
    const { el } = mountList(3);
    el(0).focus();

    arrow(el(0), 'ArrowUp');
    await flush();
    assert.equal(document.activeElement, el(2), 'ArrowUp from the first item wraps to the last');

    arrow(el(2), 'Home');
    await flush();
    assert.equal(document.activeElement, el(0));

    arrow(el(0), 'End');
    await flush();
    assert.equal(document.activeElement, el(2));
  });

  it('keeps exactly one tabbable item as focus roves', async () => {
    const { el } = mountList(3);
    assert.equal(el(0).getAttribute('tabindex'), '0');
    assert.equal(el(1).getAttribute('tabindex'), '-1');

    el(0).focus();
    arrow(el(0), 'ArrowRight');
    await flush();
    assert.equal(el(0).getAttribute('tabindex'), '-1', 'tabIndex froze at mount');
    assert.equal(el(1).getAttribute('tabindex'), '0', 'tabIndex froze at mount');
  });

  it('does not steal focus from another roving group on the page', async () => {
    const a = useRovingTabIndex(3);
    const b = useRovingTabIndex(3);
    const mk = (api, prefix) => h('div', { ...api.containerProps() },
      ...[0, 1, 2].map((i) => h('button', { id: `${prefix}${i}`, ...api.getItemProps(i) }, `${i}`)));
    mount(h('div', {}, mk(a, 'a'), mk(b, 'b')), '#app');

    const a0 = app().querySelector('#a0');
    a0.focus();
    arrow(a0, 'ArrowDown');
    await flush();
    assert.equal(document.activeElement, app().querySelector('#a1'), 'focus must stay inside the group that got the key');
  });

  it('does not grab focus at mount', async () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    mountList(3);
    await flush();
    assert.equal(document.activeElement, outside, 'mounting a roving list must not yank focus off the page');
    outside.remove();
  });

  // containerProps() is spread LAST in every real call site, so ANY role it
  // emits by default wins the object literal and relabels the caller's widget.
  // Making the default overridable was not enough: the trap is the call site
  // that never passes an override because it already wrote the role itself.
  it('containerProps no longer hard-codes a role, so the caller\'s role survives', () => {
    const roving = useRovingTabIndex(3);
    const props = { role: 'toolbar', ...roving.containerProps() };
    assert.equal(props.role, 'toolbar', 'a role written before the spread must not be rewritten');
    assert.equal('role' in roving.containerProps(), false, 'the hook must not invent a role');
  });

  it('a role can still be requested, per hook or per call site', () => {
    assert.equal(useRovingTabIndex(3, { role: 'menu' }).containerProps().role, 'menu');
    assert.equal(useRovingTabIndex(3).containerProps({ role: 'tablist' }).role, 'tablist');
    assert.equal(
      useRovingTabIndex(3, { role: 'menu' }).containerProps({ role: 'toolbar' }).role, 'toolbar',
      'the call site is more specific than the hook',
    );
  });

  it('the caller\'s role reaches the DOM through the spread', () => {
    const roving = useRovingTabIndex(3);
    mount(h('div', { id: 'tb', role: 'toolbar', 'aria-label': 'Tools', ...roving.containerProps() }), '#app');
    const el = app().querySelector('#tb');
    assert.equal(el.getAttribute('role'), 'toolbar');
    assert.equal(el.getAttribute('aria-label'), 'Tools');
  });

  it('containerProps overrides reach the DOM', () => {
    const roving = useRovingTabIndex(3);
    mount(h('div', { id: 'tb2', ...roving.containerProps({ role: 'listbox', 'aria-label': 'Fruit' }) }), '#app');
    const el = app().querySelector('#tb2');
    assert.equal(el.getAttribute('role'), 'listbox');
    assert.equal(el.getAttribute('aria-label'), 'Fruit');
  });

  it('focusItem() moves focus explicitly (e.g. a menu focusing its first item on open)', async () => {
    const { roving, el } = mountList(3);
    roving.focusItem(2);
    await flush();
    assert.equal(document.activeElement, el(2));
    assert.equal(roving.focusIndex(), 2);
  });

  it('ignores keys when the list is empty', async () => {
    const roving = useRovingTabIndex(0);
    const el = document.createElement('button');
    app().appendChild(el);
    spread(el, roving.getItemProps(0));
    el.focus();
    arrow(el, 'ArrowDown');
    await flush();
    assert.equal(roving.focusIndex(), 0);
  });

  // The compiled-JSX path is the reason items are registered with a ref OBJECT
  // and not a callback: render.js spread() treats every function-valued prop as
  // a reactive accessor, so a callback ref would be CALLED with no arguments
  // and the hook would never learn a single element.
  it('registers items through the compiled-JSX spread path too', async () => {
    const roving = useRovingTabIndex(2);
    const els = [0, 1].map((i) => {
      const b = document.createElement('button');
      app().appendChild(b);
      spread(b, roving.getItemProps(i));
      return b;
    });

    els[0].focus();
    arrow(els[0], 'ArrowRight');
    await flush();
    assert.equal(document.activeElement, els[1], 'spread() must INSTALL the item ref, not call it');
    assert.equal(els[1].getAttribute('tabindex'), '0');
  });

  it('getItemProps forwards a caller ref instead of swallowing it', async () => {
    const mine = { current: null };
    const roving = useRovingTabIndex(2);
    mount(h('div', { ...roving.containerProps() },
      h('button', { id: 'r0', ...roving.getItemProps(0) }, '0'),
      h('button', { id: 'r1', ...roving.getItemProps(1, { ref: mine }) }, '1')), '#app');

    assert.equal(mine.current, app().querySelector('#r1'), 'a ref passed to getItemProps must still be filled');
    // ...and the hook keeps its own registration, so focus still roves.
    app().querySelector('#r0').focus();
    arrow(app().querySelector('#r0'), 'ArrowRight');
    await flush();
    assert.equal(document.activeElement, app().querySelector('#r1'));
  });

  // Every item at tabindex="-1" removes the widget from the tab order entirely:
  // the keyboard user can no longer reach it at all, which is worse than a
  // roving index that is merely on the wrong item.
  it('focusItem() refuses an out-of-range index instead of un-tabbing the widget', async () => {
    const { roving, el } = mountList(3);

    assert.equal(roving.focusItem(99), null);
    await flush();
    assert.equal(el(0).getAttribute('tabindex'), '0', 'focusItem(99) left nothing tabbable');
    assert.equal(roving.focusIndex(), 0);

    assert.equal(roving.focusItem(-1), null);
    await flush();
    assert.equal(el(0).getAttribute('tabindex'), '0', 'focusItem(-1) left nothing tabbable');
    assert.equal(roving.focusIndex(), 0);
  });

  it('setFocusIndex() refuses an out-of-range index and keeps the last valid one', async () => {
    const { roving, el } = mountList(3);
    roving.setFocusIndex(2);
    roving.setFocusIndex(7);
    await flush();
    assert.equal(roving.focusIndex(), 2);
    assert.equal(el(2).getAttribute('tabindex'), '0');
    assert.equal(el(0).getAttribute('tabindex'), '-1');
  });

  // WAI-ARIA requires exactly one tabbable item at all times. A count that
  // shrinks past the current index has no key press behind it, so the clamp has
  // to happen where the tabIndex is read.
  it('keeps exactly one tabbable item when a dynamic count shrinks past the index', async () => {
    const count = signal(4);
    const roving = useRovingTabIndex(() => count());
    mount(h('div', { ...roving.containerProps() },
      ...[0, 1, 2, 3].map((i) => h('button', { id: `d${i}`, ...roving.getItemProps(i) }, `${i}`))), '#app');
    const el = (i) => app().querySelector(`#d${i}`);

    el(0).focus();
    arrow(el(0), 'End');
    await flush();
    assert.equal(document.activeElement, el(3));

    count.set(2);
    await flush();
    assert.equal(el(1).getAttribute('tabindex'), '0', 'the last surviving item must become tabbable');
    assert.equal(el(0).getAttribute('tabindex'), '-1');
    assert.equal(roving.focusIndex(), 1);

    // ArrowRight from the clamped position wraps within the SHRUNKEN list.
    el(1).focus();
    arrow(el(1), 'ArrowRight');
    await flush();
    assert.equal(document.activeElement, el(0));
  });
});

// The mechanism that locates items has to survive the architecture What ships
// as a headline feature. Every test here goes through renderToString() and then
// hydrate(), because hydrate() is what resets the useId counter, and islands
// hydrate ONE AT A TIME through their own hydrate() call (components.js
// hydrateInto). A client-only mount cannot see any of this.
describe('#57 useRovingTabIndex under SSR + islands', () => {
  beforeEach(() => { app().innerHTML = ''; });

  const arrow = (el, key) => el.dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );

  function Toolbar({ prefix }) {
    const roving = useRovingTabIndex(3);
    return h('div', { role: 'toolbar', ...roving.containerProps() },
      ...[0, 1, 2].map((i) => h('button', { id: `${prefix}${i}`, ...roving.getItemProps(i) }, `${i}`)));
  }

  it('an island hydrated alone still roves when an earlier component consumed a useId', async () => {
    function Page() {
      const heading = useId('label');
      return h('div', {},
        h('h2', { id: heading() }, 'Tools'),
        h('div', { 'data-island': 'Toolbar' }, h(Toolbar, { prefix: 'x' })),
      );
    }

    const html = renderToString(h(Page, {}));
    // The heading is the whole point of the fixture: it consumes id #1 on the
    // server, the client never renders it, and hydrate() restarts the counter.
    // Anything the island derives from that counter therefore comes out
    // DIFFERENT than the server wrote, and a static attribute holding it is
    // never reconciled (hydrateElementProps skips static props).
    assert.match(html, /id="label-1"/);

    app().innerHTML = html;
    hydrate(h(Toolbar, { prefix: 'x' }), app().querySelector('[data-island]'));
    await flush();

    const el = (i) => app().querySelector(`#x${i}`);
    el(0).focus();
    arrow(el(0), 'ArrowRight');
    await flush();

    assert.equal(document.activeElement, el(1), 'a hydrated island must MOVE focus, not only shuffle tabindex');
    assert.equal(el(1).getAttribute('tabindex'), '0');
    assert.equal(el(0).getAttribute('tabindex'), '-1');
  });

  it('two islands on one page rove independently instead of into each other', async () => {
    function Page() {
      return h('div', {},
        h('div', { 'data-island': 'A' }, h(Toolbar, { prefix: 'a' })),
        h('div', { 'data-island': 'B' }, h(Toolbar, { prefix: 'b' })),
      );
    }

    app().innerHTML = renderToString(h(Page, {}));
    const islands = app().querySelectorAll('[data-island]');
    hydrate(h(Toolbar, { prefix: 'a' }), islands[0]);
    await flush();
    hydrate(h(Toolbar, { prefix: 'b' }), islands[1]);
    await flush();

    const el = (id) => app().querySelector(`#${id}`);
    el('b0').focus();
    arrow(el('b0'), 'ArrowRight');
    await flush();

    assert.equal(document.activeElement, el('b1'), 'ArrowRight in island B must not jump into island A');
    assert.equal(el('a0').getAttribute('tabindex'), '0', 'island A must keep its own tabbable item');
    assert.equal(el('b1').getAttribute('tabindex'), '0');

    el('a0').focus();
    arrow(el('a0'), 'ArrowRight');
    await flush();
    assert.equal(document.activeElement, el('a1'));
    assert.equal(el('b1').getAttribute('tabindex'), '0', 'island B keeps its position while A moves');
  });

  it('serializes no group bookkeeping into the HTML', () => {
    const roving = useRovingTabIndex(2);
    const html = renderToString(h('div', { ...roving.containerProps() },
      h('button', { ...roving.getItemProps(0) }, '0'),
      h('button', { ...roving.getItemProps(1) }, '1')));

    // Nothing derived from a counter may reach the DOM: hydration never
    // reconciles a static attribute, so it would silently keep a stale value.
    assert.doesNotMatch(html, /data-what-roving/);
    assert.doesNotMatch(html, /\bref=/);
    // The one thing that DOES belong in the HTML: the initial tab stop. The
    // match is case-insensitive because renderToString serializes the prop name
    // verbatim (`tabIndex="0"`), which the HTML parser lowercases on the way in.
    assert.match(html, /tabindex="0"/i);
    assert.match(html, /tabindex="-1"/i);
  });
});
