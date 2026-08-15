// A reactive attribute value must be RESOLVED on the server, not stringified.
//
// renderAttrs skipped event handlers and then fell through to
// `escapeHtml(String(val))` for everything else. A function stringifies as its
// own source text, so the framework's documented way to make an attribute
// reactive:
//
//   <span className={() => theme()}>
//
// server-rendered as:
//
//   <span class="() =&gt; theme()">
//
// Three separate consequences, all silent. The real class was missing from the
// HTML, so CSS keyed on it did not apply to what a crawler or a no-JS visitor
// saw. The page shipped JavaScript source inside an attribute, which is a
// nonsense value for every attribute and a wrong one for href/src. And the
// client replaced it during hydration, so anyone checking in a browser devtools
// pane saw the correct value and never suspected the served bytes differed.
//
// what-router's <Link> hit this on every single link: it always passes a thunk
// as `class` so the active state can update on navigation. Every server-rendered
// nav shipped Link's closure source in place of its classes.
//
// No unit test caught it because SSR tests pass literal attribute values and
// reactivity tests run on the client. Broken only in combination, like every
// bug in this class.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { h, signal } from 'what-core';
import { renderToString, renderToHydratableString, renderToStream } from '../src/index.js';

async function collectStream(vnode, opts) {
  let out = '';
  for await (const chunk of renderToStream(vnode, opts)) out += chunk;
  return out;
}

/** The same tree through all three server paths, so a fix cannot land in one. */
async function renderAllPaths(vnode) {
  const hydratable = await renderToHydratableString(vnode);
  return {
    string: await renderToString(vnode),
    hydratable: typeof hydratable === 'string' ? hydratable : hydratable.html,
    stream: await collectStream(vnode),
  };
}

function eachPath(rendered, fn) {
  for (const [name, html] of Object.entries(rendered)) fn(html, name);
}

describe('SSR resolves reactive attribute values', () => {
  it('renders a thunk class as its value, not its source', async () => {
    const theme = signal('dark');
    const rendered = await renderAllPaths(h('span', { className: () => theme() }, 'hi'));

    eachPath(rendered, (html, path) => {
      assert.match(html, /class="dark"/, `${path} should render the resolved class`);
      assert.doesNotMatch(html, /=&gt;|=>/, `${path} leaked function source: ${html}`);
      assert.ok(!html.includes('theme()'), `${path} leaked the closure body: ${html}`);
    });
  });

  it('reads the value at render time, so a signal write before render is reflected', async () => {
    const count = signal(1);
    count(42);
    const rendered = await renderAllPaths(h('div', { 'data-count': () => count() }, 'x'));
    eachPath(rendered, (html, path) => {
      assert.match(html, /data-count="42"/, `${path} rendered a stale or unresolved value: ${html}`);
    });
  });

  it('applies attribute semantics to the RESOLVED value, not the function', async () => {
    // A function is truthy, so before the fix every one of these produced an
    // attribute. The resolved value is what decides omit/boolean/aria.
    const rendered = await renderAllPaths(
      h('input', {
        disabled: () => false,          // false -> omitted
        required: () => true,           // true  -> bare boolean attr
        'aria-expanded': () => false,   // false -> explicit "false", enumerated
        'data-nothing': () => null,     // null  -> omitted
        'data-empty': () => '',         // ''    -> kept, it is a real value
      }),
    );

    eachPath(rendered, (html, path) => {
      assert.ok(!html.includes('disabled'), `${path} kept a false boolean attr: ${html}`);
      assert.match(html, /(?<!-)required(?!=)/, `${path} dropped a true boolean attr: ${html}`);
      assert.match(html, /aria-expanded="false"/, `${path} lost enumerated aria semantics: ${html}`);
      assert.ok(!html.includes('data-nothing'), `${path} kept a null attr: ${html}`);
      assert.match(html, /data-empty=""/, `${path} dropped an empty-string attr: ${html}`);
    });
  });

  it('escapes the resolved value', async () => {
    // Resolving must not become a hole: the value still goes through escaping.
    const rendered = await renderAllPaths(h('div', { title: () => '"><script>alert(1)</script>' }));
    eachPath(rendered, (html, path) => {
      assert.ok(!html.includes('<script>'), `${path} emitted unescaped markup: ${html}`);
      assert.match(html, /&quot;/, `${path} did not escape the quote: ${html}`);
    });
  });

  it('refuses an unsafe URL the thunk resolves to', async () => {
    // The javascript: check ran against "() => ..." before, which is not a
    // javascript: URL, so the guard passed and the real value was never tested.
    const rendered = await renderAllPaths(h('a', { href: () => 'javascript:alert(1)' }, 'x'));
    eachPath(rendered, (html, path) => {
      assert.ok(!html.includes('javascript:'), `${path} let an unsafe href through: ${html}`);
    });
  });

  it('still skips event handlers rather than calling them', async () => {
    let called = false;
    const rendered = await renderAllPaths(h('button', { onclick: () => { called = true; } }, 'x'));
    assert.equal(called, false, 'SSR must not invoke an event handler');
    eachPath(rendered, (html, path) => {
      assert.ok(!html.includes('onclick'), `${path} emitted an event handler: ${html}`);
    });
  });

  it('drops the attribute instead of failing the page when a thunk throws', async () => {
    // Fail soft: one attribute that cannot resolve must not take down the
    // response, because a partial page beats a 500.
    const rendered = await renderAllPaths(
      h('div', { 'data-ok': () => 'yes', 'data-bad': () => { throw new Error('nope'); } }, 'body'),
    );
    eachPath(rendered, (html, path) => {
      assert.match(html, /data-ok="yes"/, `${path} lost the sibling attribute: ${html}`);
      assert.ok(!html.includes('data-bad'), `${path} emitted the failed attribute: ${html}`);
      assert.match(html, /body/, `${path} lost the element content: ${html}`);
    });
  });

  it('omits an attribute whose thunk resolves to another function', async () => {
    const rendered = await renderAllPaths(h('div', { 'data-fn': () => () => 1 }));
    eachPath(rendered, (html, path) => {
      assert.ok(!html.includes('data-fn'), `${path} emitted a function value: ${html}`);
    });
  });

  it('renders a signal passed directly as an attribute value', async () => {
    // A signal IS a function, so it took the same broken path and rendered as
    // the signal implementation's source.
    const label = signal('Save');
    const rendered = await renderAllPaths(h('div', { 'data-label': label }));
    eachPath(rendered, (html, path) => {
      assert.match(html, /data-label="Save"/, `${path} did not resolve the signal: ${html}`);
    });
  });

  it('server-renders a router-style active-class thunk', async () => {
    // The exact shape what-router's <Link> produces, including its `|| undefined`
    // return for "no classes at all".
    const path = signal('/about');
    const linkClass = (href, extra) => () => [
      extra,
      path() === href && 'active',
    ].filter(Boolean).join(' ') || undefined;

    const rendered = await renderAllPaths(
      h('nav', {},
        h('a', { href: '/about', class: linkClass('/about', 'nav-link') }, 'About'),
        h('a', { href: '/contact', class: linkClass('/contact') }, 'Contact'),
      ),
    );

    eachPath(rendered, (html, name) => {
      assert.match(html, /class="nav-link active"/, `${name} lost the active class: ${html}`);
      // The second link resolves to undefined, which means no class attribute
      // rather than class="undefined".
      assert.ok(!html.includes('class="undefined"'), `${name} stringified undefined: ${html}`);
      assert.ok(!html.includes('filter(Boolean)'), `${name} leaked closure source: ${html}`);
    });
  });
});
