// In development, hydration reports an attribute whose server value differs
// from the value the client's first write gives it: an ERR_HYDRATION_MISMATCH
// of kind `attribute`, with the element's path, the attribute's name, both
// values and the owner. Not reported: values the DOM reads as equal (a
// boolean attribute's presence, the same style declarations), an attribute
// the client does not write (the server's data-hk, a stale one), and a form
// field the user changed before hydration. Production builds carry none of
// it (npm run check:size).

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM();

const { h, hydrate, flushSync } = await import('../src/index.js');
const { __resetHydrationData } = await import('../src/hydration-data.js');
const { clearDiagnostics, getDiagnostics } = await import('../src/diagnostics.js');
const server = await import('../../server/src/index.js');

const SOURCE = `
  export const Card = (props) => (
    <div class="card" id={'card-' + props.n} title={props.title} data-n={props.n}>
      <span aria-hidden="true">*</span>
      <a href={props.href} style={props.style}>{props.n}</a>
    </div>
  );
  export const Badge = () => <i class="a b" data-x="1">!</i>;
  export const Flags = () => <input disabled readOnly={true} />;
  export const Field = (props) => <form><input name="q" value={props.q} /><input type="checkbox" checked={props.on} /></form>;
`;
const client = await loadCompiled(SOURCE, { pluginOptions: { hydratable: true } });
const ssr = await loadCompiled(SOURCE, { pluginOptions: { generate: 'ssr' } });

const PROPS = { n: 1, title: 't', href: '/docs/a', style: { color: 'red', 'margin-top': '2px' } };

function hostWith(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

// Hydrates `tree` into `host` and returns the attribute mismatches reported
// (the diagnostics' records) and the diagnostics themselves. The
// onHydrationError hook hears none: its records are the same in every build.
function hydrateReporting(tree, host, before) {
  const heard = [];
  clearDiagnostics();
  const realError = console.error;
  console.error = () => {};
  let stop;
  try {
    if (before) before(host);
    stop = hydrate(tree, host, { onHydrationError: (info) => heard.push(info) });
    flushSync();
  } finally {
    console.error = realError;
  }
  stop();
  assert.deepEqual(heard.filter((r) => r.kind === 'attribute'), []);
  const diagnostics = getDiagnostics().events.filter((e) => e.code === 'ERR_HYDRATION_MISMATCH' && e.data.kind === 'attribute');
  return { reports: diagnostics.map((e) => e.data), diagnostics };
}

beforeEach(() => {
  document.body.textContent = '';
  __resetHydrationData();
});

describe('hydration reports an attribute that differs', () => {
  it('reports nothing where the server wrote what the client writes', () => {
    const host = hostWith(server.renderToHydratableString(h(ssr.Card, PROPS)));
    const { reports, diagnostics } = hydrateReporting(h(client.Card, PROPS), host);
    assert.deepEqual(reports, []);
    assert.deepEqual(diagnostics, []);
  });

  it('a binding\'s value the server wrote otherwise, with the path, the name, both values and the owner', () => {
    const host = hostWith(server.renderToHydratableString(h(ssr.Card, PROPS)));
    const { reports, diagnostics } = hydrateReporting(h(client.Card, { ...PROPS, title: 'client' }), host);
    assert.deepEqual(reports, [{
      kind: 'attribute',
      component: 'Card',
      ownerPath: reports[0]?.ownerPath,
      path: 'div',
      attribute: 'title',
      expected: 'title="client"',
      found: 'title="t"',
      recovery: 'client-value',
    }]);
    assert.ok(reports[0].ownerPath !== undefined);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].data.attribute, 'title');
  });

  it('a static attribute the server wrote otherwise (aria-hidden="" against "true")', () => {
    const html = server.renderToHydratableString(h(ssr.Card, PROPS)).replace('aria-hidden="true"', 'aria-hidden=""');
    const { reports } = hydrateReporting(h(client.Card, PROPS), hostWith(html));
    assert.deepEqual(reports.map((r) => [r.path, r.attribute, r.expected, r.found]), [['div>span', 'aria-hidden', 'aria-hidden="true"', 'aria-hidden=""']]);
  });

  it('an attribute only one side wrote', () => {
    const html = server.renderToHydratableString(h(ssr.Card, PROPS));
    const { reports } = hydrateReporting(h(client.Card, { ...PROPS, title: undefined }), hostWith(html));
    assert.deepEqual(reports.map((r) => [r.attribute, r.expected, r.found]), [['title', 'no title', 'title="t"']]);
    const missing = hydrateReporting(h(client.Card, PROPS), hostWith(server.renderToHydratableString(h(ssr.Card, { ...PROPS, title: undefined }))));
    assert.deepEqual(missing.reports.map((r) => [r.attribute, r.expected, r.found]), [['title', 'title="t"', 'no title']]);
  });

  it('a URL as written, not as the browser resolves it', () => {
    const html = server.renderToHydratableString(h(ssr.Card, PROPS)).replace('href="/docs/a"', 'href="http://localhost/docs/a"');
    const { reports } = hydrateReporting(h(client.Card, PROPS), hostWith(html));
    assert.deepEqual(reports.map((r) => [r.path, r.attribute]), [['div>a', 'href']]);
  });

  it('class tokens in another order', () => {
    const { reports } = hydrateReporting(h(client.Badge), hostWith('<i class="b a" data-x="1">!</i>'));
    assert.deepEqual(reports.map((r) => [r.attribute, r.expected, r.found]), [['class', 'class="a b"', 'class="b a"']]);
  });

  it('an h() element\'s prop the server wrote otherwise', () => {
    const { reports } = hydrateReporting(h('p', { title: 'client', class: 'x' }, 'hi'), hostWith('<p title="server" class="x">hi</p>'));
    assert.deepEqual(reports.map((r) => [r.component, r.path, r.attribute, r.expected, r.found]), [['root', 'p', 'title', 'title="client"', 'title="server"']]);
  });
});

describe('hydration does not report an attribute that only looks different', () => {
  it('a boolean attribute present on both sides, whatever its value', () => {
    const { reports } = hydrateReporting(h(client.Flags), hostWith('<input disabled="disabled" readonly="readonly">'));
    assert.deepEqual(reports, []);
  });

  it('style declarations the DOM reads as the same', () => {
    const html = server.renderToHydratableString(h(ssr.Card, PROPS)).replace(/style="[^"]*"/, 'style="color:red;margin-top:2px"');
    const { reports } = hydrateReporting(h(client.Card, PROPS), hostWith(html));
    assert.deepEqual(reports, []);
  });

  it('a text field\'s value left out on one side and empty on the other', () => {
    const { reports } = hydrateReporting(h('input', { type: 'text', defaultValue: '' }), hostWith('<input type="text">'));
    assert.deepEqual(reports, []);
  });

  it('a class of undefined, which neither side writes', () => {
    const { reports } = hydrateReporting(h('a', { href: '/x', class: () => undefined }, 'x'), hostWith('<a href="/x">x</a>'));
    assert.deepEqual(reports, []);
  });

  it('a prop named in camel case (tabIndex is tabindex)', () => {
    const { reports } = hydrateReporting(h('button', { tabIndex: 0 }, 'go'), hostWith('<button tabindex="0">go</button>'));
    assert.deepEqual(reports, []);
  });

  it('an attribute the client does not write (data-hk, a stale one)', () => {
    const { reports } = hydrateReporting(h(client.Badge), hostWith('<i class="a b" data-x="1" data-hk="9" lang="fr">!</i>'));
    assert.deepEqual(reports, []);
  });

  it('a form field the user changed before hydration', () => {
    const html = server.renderToHydratableString(h(ssr.Field, { q: 'server', on: false }));
    const { reports } = hydrateReporting(h(client.Field, { q: 'server', on: false }), hostWith(html), (host) => {
      const [text, box] = host.querySelectorAll('input');
      text.value = 'typed';
      box.checked = true;
    });
    assert.deepEqual(reports, []);
  });
});
