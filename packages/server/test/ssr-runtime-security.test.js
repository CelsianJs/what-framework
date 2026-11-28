// The security rules of the vnode renderer (ssr-security.test.js,
// ssr-security-caches.test.js), held on the compiled path: JSX compiled with
// what-compiler's server target and rendered by every what-server renderer.
// Values only known at run time go through ssr-runtime.js; static values are
// checked by the compiler (packages/compiler/test/ssr-target.test.js).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { renderToString, renderToHydratableString, renderToStream } from '../src/index.js';

const compile = (source) => loadCompiled(source, { pluginOptions: { generate: 'ssr' } });

async function streamed(node) {
  let html = '';
  for await (const chunk of renderToStream(node, { onError: () => {} })) html += chunk;
  return html;
}

const RENDERERS = [
  ['string', renderToString],
  ['hydratable', renderToHydratableString],
  ['stream', streamed],
];

function silenced(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

const mod = await compile(`
  export const link = (attr, v) => attr === 'href' ? <a href={v}>x</a>
    : attr === 'src' ? <a src={v}>x</a>
    : attr === 'action' ? <a action={v}>x</a>
    : attr === 'formaction' ? <a formaction={v}>x</a>
    : attr === 'data' ? <a data={v}>x</a>
    : attr === 'ping' ? <a ping={v}>x</a>
    : <a xlink:href={v}>x</a>;
  export const spread = (props) => <div {...props} />;
  export const spreadWithChildren = (props) => <div {...props}><b>kept</b></div>;
  export const inner = (v) => <div innerHTML={v} />;
  export const dangerous = (v) => <div dangerouslySetInnerHTML={v}>fallback</div>;
  export const srcdoc = (v) => <iframe srcdoc={v}></iframe>;
  export const upperSrcdoc = (v) => <iframe SRCDOC={v}></iframe>;
  export const handlers = (v) => <div onclick={v} ONCLICK={v} OnClick={v} onclick__once={v} on="x" />;
  export const text = (v) => <p title={v} data-v={v}>{v}</p>;
  export const enumerated = (v) => <div aria-expanded={v} data-open={v} role={v} hidden={v} title={v} />;
  export const dynamicTag = (Tag) => <section><Tag>x</Tag></section>;
`);

describe('compiled SSR: URL attributes are scheme-checked at run time', () => {
  const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'data', 'ping', 'xlink:href'];
  const HOSTILE = [
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:alert(1)',
    'JaVaScRiPt:alert(1)', '  \u0001javascript:alert(1)', 'java\nscript:alert(1)',
  ];
  for (const [name, render] of RENDERERS) {
    it(`${name}: drops every hostile URL and keeps safe ones`, async () => {
      for (const attr of URL_ATTRS) {
        for (const value of HOSTILE) {
          for (const v of [value, () => value]) {
            const html = await render(mod.link(attr, v));
            assert.equal(html, '<a>x</a>', `${attr}=${JSON.stringify(value)} reached the HTML`);
          }
        }
        for (const safe of ['/safe', 'https://example.com', 'mailto:a@b.c', '#top']) {
          assert.equal(await render(mod.link(attr, safe)), `<a ${attr}="${safe}">x</a>`);
        }
      }
    });
  }
});

describe('compiled SSR: spread attribute names are validated', () => {
  for (const [name, render] of RENDERERS) {
    it(`${name}: skips names that could inject markup, on every value path`, async () => {
      const bad = ['x" onload="alert(1)', 'a b', 'a=b', 'a"b', "a'b", 'a>b', 'a<b', 'a/b', 'a\nb', ''];
      for (const key of bad) {
        for (const value of ['v', true, false, () => 'v']) {
          const html = await silenced(() => render(mod.spread({ [key]: value })));
          assert.equal(html, '<div></div>', `${JSON.stringify(key)} reached the HTML: ${html}`);
        }
      }
    });

    it(`${name}: keeps data-*, aria-*, namespaced and dotted names`, async () => {
      const html = await render(mod.spread({ 'data-test-id': 'abc', 'aria-hidden': true, 'xlink:href': '#i', 'e.g': 'ok' }));
      assert.equal(html, '<div data-test-id="abc" aria-hidden="true" xlink:href="#i" e.g="ok"></div>');
    });

    it(`${name}: refuses srcdoc, hostile URLs and handlers that arrive through a spread`, async () => {
      const html = await silenced(() => render(mod.spreadWithChildren({
        srcdoc: '<script>alert(1)</script>', href: 'javascript:alert(1)', onclick: 'alert(1)', ONLOAD: 'x', title: 't',
      })));
      assert.equal(html, '<div title="t"><b>kept</b></div>');
    });

    it(`${name}: attribute-name injection never executes in a real DOM`, async () => {
      const html = await silenced(() => render(mod.spread({
        'data-x" onclick="globalThis.__audit_marker=1" data-y': false,
        'aria-x" onmouseover="globalThis.__audit_marker=2" data-y': () => false,
      })));
      const dom = new JSDOM(html, { runScripts: 'dangerously' });
      try {
        const el = dom.window.document.querySelector('div');
        el.click();
        el.dispatchEvent(new dom.window.MouseEvent('mouseover'));
        assert.equal(dom.window.__audit_marker, undefined);
        assert.equal(el.hasAttribute('onclick'), false);
      } finally {
        dom.window.close();
      }
    });
  }
});

describe('compiled SSR: innerHTML requires { __html }', () => {
  for (const [name, render] of RENDERERS) {
    it(`${name}: renders a wrapped value raw and drops a raw string`, async () => {
      assert.equal(await render(mod.inner({ __html: '<b>trusted</b>' })), '<div><b>trusted</b></div>');
      assert.equal(await silenced(() => render(mod.inner('<img src=x onerror=alert(1)>'))), '<div></div>');
      assert.equal(await render(mod.dangerous({ __html: '<i>t</i>' })), '<div><i>t</i></div>');
      assert.equal(await render(mod.dangerous(null)), '<div>fallback</div>');
      assert.equal(await silenced(() => render(mod.spread({ innerHTML: '<script>x</script>' }))), '<div></div>');
    });
  }
});

describe('compiled SSR: srcdoc is never rendered', () => {
  for (const [name, render] of RENDERERS) {
    it(`${name}: refuses a dynamic srcdoc in any case`, async () => {
      for (const make of [mod.srcdoc, mod.upperSrcdoc]) {
        for (const v of ['<script>alert(1)</script>', () => '<b>x</b>']) {
          const html = await silenced(() => render(make(v)));
          assert.equal(html, '<iframe></iframe>');
        }
      }
    });
  }
});

describe('compiled SSR: event handlers never reach the markup', () => {
  for (const [name, render] of RENDERERS) {
    it(`${name}: drops every handler spelling, keeps an attribute named "on"`, async () => {
      assert.equal(await render(mod.handlers('alert(1)')), '<div on="x"></div>');
    });
  }
});

describe('compiled SSR: five-character escaping', () => {
  for (const [name, render] of RENDERERS) {
    it(`${name}: escapes text and attribute values`, async () => {
      const v = `<script>"'&</script>`;
      const e = '&lt;script&gt;&quot;&#39;&amp;&lt;/script&gt;';
      assert.equal(await render(mod.text(v)), `<p title="${e}" data-v="${e}">${e}</p>`);
    });
  }
});

describe('compiled SSR: enumerated attributes keep false', () => {
  for (const [name, render] of RENDERERS) {
    it(`${name}: writes aria/data/role false, drops boolean false and null`, async () => {
      assert.equal(await render(mod.enumerated(false)), '<div aria-expanded="false" data-open="false" role="false"></div>');
      assert.equal(await render(mod.enumerated(() => false)), '<div aria-expanded="false" data-open="false" role="false"></div>');
      assert.equal(await render(mod.enumerated(null)), '<div></div>');
      assert.equal(await render(mod.enumerated(true)), '<div aria-expanded="true" data-open="true" role="true" hidden title></div>');
    });
  }
});

describe('compiled SSR: a tag computed at run time is checked', () => {
  it('refuses a tag name carrying injected attributes, on every renderer', async () => {
    assert.throws(() => renderToString(mod.dynamicTag('div onload=alert(1) x')), /Invalid tag name/);
    assert.throws(() => renderToHydratableString(mod.dynamicTag('div onload=alert(1) x')), /Invalid tag name/);
    await assert.rejects(() => streamed(mod.dynamicTag('div><script>alert(1)</script')), /Invalid tag name/);
  });

  it('renders custom elements and SVG camelCase tags', () => {
    assert.equal(renderToString(mod.dynamicTag('my-widget')), '<section><my-widget>x</my-widget></section>');
    assert.equal(renderToString(mod.dynamicTag('clipPath')), '<section><clipPath>x</clipPath></section>');
  });
});
