// Every markup rule holds on every path that writes markup or sets an
// attribute. The rules exist once, in what-core's markup-rules.js; this file
// walks each of its tables and checks the rule on each path, so a path that
// stops applying one (a back end with its own copy of a list, a helper that
// skips a check) fails here, whichever table it is:
//
//   h() server       renderToString, renderToHydratableString, renderToStream
//   compiled server  what-compiler generate:"ssr", static and dynamic values,
//                    rendered by the same three
//   h() client       what-core's mount() (dom.js setProp)
//   compiled client  what-compiler generate:"dom", static values (baked into
//                    the template) and dynamic ones (render.js setProp)
//
// A rule a static value breaks is a compile error (ERR_UNSAFE_STATIC_MARKUP)
// on both back ends, where the source fixes the value.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const rules = await import('what-core/internal/markup-rules');
const { renderToString, renderToHydratableString, renderToStream } = await import('../src/index.js');
const { h } = await import('what-core');
const { mount } = await import('../../core/src/dom.js');
const { flushSync } = await import('../../core/src/reactive.js');

const quiet = (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = warn; }
};

async function streamed(node) {
  let html = '';
  for await (const chunk of renderToStream(node, { onError: () => {} })) html += chunk;
  return html;
}

// Every server rendering of `node`, de-keyed (hydration keys are not markup
// rules), each as one string.
async function serverRenders(make) {
  return quiet(() => [
    renderToString(make()),
    renderToHydratableString(make()).replace(/ data-hk="h\d+"/g, ''),
  ]).concat(await streamed(make()));
}

const container = () => {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
};

function mountH(vnode) {
  const host = container();
  quiet(() => mount(vnode, host));
  flushSync();
  return host;
}

let mod = 0;
async function compiled(jsx, generate, params = 'v') {
  return loadCompiled(`export const make${mod} = (${params}) => ${jsx};`, { pluginOptions: { generate } })
    .then((m) => m[`make${mod++}`]);
}

function mountCompiled(node) {
  const host = container();
  quiet(() => host.append(node));
  flushSync();
  return host;
}

function staticError(jsx, generate) {
  try {
    compileJSX(`const a = ${jsx};`, { pluginOptions: { generate } });
  } catch (e) {
    return e.code;
  }
  return null;
}

const HOSTILE_MARKUP = '<img src=x onerror=alert(1)>';
const HOSTILE_URLS = ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)'];

// A JSX attribute name for each spelling a prop arrives in.
const spellings = (name) => [...new Set([name, name.toUpperCase(), name === 'outerhtml' ? 'outerHTML' : name === 'srcdoc' ? 'srcDoc' : name])];

describe('markup rules: refused props (REFUSED_ATTRS)', () => {
  for (const base of rules.REFUSED_ATTRS) {
    for (const name of spellings(base)) {
      it(`${name} is never written or applied`, async () => {
        for (const html of await serverRenders(() => h('iframe', { [name]: HOSTILE_MARKUP }))) {
          assert.equal(html, '<iframe></iframe>', `h() server wrote ${name}`);
        }
        const dynamicServer = await compiled(`<iframe ${name}={v} />`, 'ssr');
        for (const html of await serverRenders(() => dynamicServer(HOSTILE_MARKUP))) {
          assert.equal(html, '<iframe></iframe>', `compiled server wrote ${name}`);
        }
        const viaH = mountH(h('iframe', { [name]: HOSTILE_MARKUP })).firstChild;
        assert.equal(viaH.attributes.length, 0, `h() client applied ${name}`);
        const dynamicClient = await compiled(`<iframe ${name}={v} />`, 'dom');
        const viaCompiled = mountCompiled(dynamicClient(HOSTILE_MARKUP)).firstChild;
        assert.equal(viaCompiled.attributes.length, 0, `compiled client applied ${name}`);
        for (const generate of ['ssr', 'dom']) {
          assert.equal(staticError(`<iframe ${name}="${HOSTILE_MARKUP}" />`, generate), 'ERR_UNSAFE_STATIC_MARKUP', `static ${name}, ${generate}`);
        }
      });
    }
  }

  it('a prop that only resembles one is written everywhere', async () => {
    for (const html of await serverRenders(() => h('div', { 'data-outerhtml': 'x' }))) assert.equal(html, '<div data-outerhtml="x"></div>');
    assert.equal(staticError('<div data-srcdoc="x" />', 'ssr'), null);
    assert.equal(staticError('<div data-srcdoc="x" />', 'dom'), null);
  });
});

describe('markup rules: URL attributes (URL_ATTRS, isUnsafeUrl)', () => {
  // The JSX name for each table entry: the table is lower case, a prop is not.
  const jsxName = (name) => (name === 'xlinkhref' ? 'xlinkHref' : name === 'formaction' ? 'formAction' : name);
  for (const base of rules.URL_ATTRS) {
    const name = jsxName(base);
    it(`${name}: a javascript:, data: or vbscript: URL is never written or applied; a safe one always is`, async () => {
      const dynamicServer = await compiled(`<a ${name}={v}>x</a>`, 'ssr');
      const dynamicClient = await compiled(`<a ${name}={v}>x</a>`, 'dom');
      for (const url of HOSTILE_URLS) {
        for (const html of [...await serverRenders(() => h('a', { [name]: url }, 'x')), ...await serverRenders(() => dynamicServer(url))]) {
          assert.equal(html, '<a>x</a>', `server wrote ${name}=${JSON.stringify(url)}`);
        }
        assert.equal(rules.isUnsafeUrl(url), true);
        for (const host of [mountH(h('a', { [name]: url }, 'x')), mountCompiled(dynamicClient(url))]) {
          const el = host.firstChild;
          assert.equal(el.attributes.length, 0, `client applied ${name}=${JSON.stringify(url)}`);
        }
        const literal = url.replace(/\t/g, '');
        for (const generate of ['ssr', 'dom']) {
          assert.equal(staticError(`<a ${name}="${literal.replace(/"/g, '&quot;')}">x</a>`, generate), 'ERR_UNSAFE_STATIC_MARKUP', `static ${name}=${literal}, ${generate}`);
        }
      }
      const attr = rules.attributeName(name);
      for (const html of [...await serverRenders(() => h('a', { [name]: '/ok' }, 'x')), ...await serverRenders(() => dynamicServer('/ok'))]) {
        assert.equal(html, `<a ${attr}="/ok">x</a>`);
      }
      assert.equal(staticError(`<a ${name}="/ok">x</a>`, 'dom'), null);
      assert.equal(staticError(`<a ${name}="/ok">x</a>`, 'ssr'), null);
    });
  }
});

describe('markup rules: SVG animation values are URLs (URL_ATTRS, isUnsafeUrl)', () => {
  // <animate attributeName="href"> sets the href to each of these after the
  // URL rule checked the element's own attributes, so they are URL attributes
  // too, and a refused URL anywhere in a `values` list is refused.
  for (const name of ['values', 'to', 'from', 'by']) {
    it(`${name}: a value with a javascript:, data: or vbscript: URL among its items is never written or applied on <animate>; an ordinary one always is`, async () => {
      assert.equal(rules.isUrlAttr(name), true);
      const dynamicServer = await compiled(`<svg><a href="#x"><animate attributeName="href" ${name}={v} /></a></svg>`, 'ssr');
      const dynamicClient = await compiled(`<svg><a href="#x"><animate attributeName="href" ${name}={v} /></a></svg>`, 'dom');
      const viaH = (value) => h('svg', null, h('a', { href: '#x' }, h('animate', { attributeName: 'href', [name]: value })));
      for (const url of HOSTILE_URLS) {
        const value = name === 'values' ? `#x;${url}` : url;
        assert.equal(rules.isUnsafeUrl(value), true, JSON.stringify(value));
        for (const html of [...await serverRenders(() => viaH(value)), ...await serverRenders(() => dynamicServer(value))]) {
          assert.ok(!html.includes(` ${name}=`), `server wrote ${name}=${JSON.stringify(value)}: ${html}`);
        }
        for (const host of [mountH(viaH(value)), mountCompiled(dynamicClient(value))]) {
          assert.equal(host.querySelector('animate').hasAttribute(name), false, `client applied ${name}=${JSON.stringify(value)}`);
        }
        const literal = value.replace(/\t/g, '').replace(/"/g, '&quot;');
        for (const generate of ['ssr', 'dom']) {
          assert.equal(staticError(`<svg><animate attributeName="href" ${name}="${literal}" /></svg>`, generate), 'ERR_UNSAFE_STATIC_MARKUP', `static ${name}, ${generate}`);
        }
      }
      const ordinary = name === 'values' ? '0;1;0' : '#y';
      for (const html of await serverRenders(() => viaH(ordinary))) assert.ok(html.includes(` ${name}="${ordinary}"`), html);
      assert.equal(mountH(viaH(ordinary)).querySelector('animate').getAttribute(name), ordinary);
      assert.equal(staticError(`<svg><animate attributeName="opacity" ${name}="${ordinary}" /></svg>`, 'dom'), null);
    });
  }

  it('a URL whose text holds ";" is refused only when an item of it is a refused URL', () => {
    assert.equal(rules.isUnsafeUrl('/a;b?c=1'), false);
    assert.equal(rules.isUnsafeUrl('https://shop.test/x;y'), false);
    assert.equal(rules.isUnsafeUrl('/a;javascript:alert(1)'), true);
  });
});

describe('markup rules: innerHTML takes { __html } only (INNER_HTML_PROPS)', () => {
  for (const name of rules.INNER_HTML_PROPS) {
    it(`${name}: a string is never parsed, { __html } always is`, async () => {
      for (const html of await serverRenders(() => h('div', { [name]: HOSTILE_MARKUP }))) assert.equal(html, '<div></div>');
      const dynamicServer = await compiled(`<div ${name}={v} />`, 'ssr');
      for (const html of await serverRenders(() => dynamicServer(HOSTILE_MARKUP))) assert.equal(html, '<div></div>');
      for (const html of await serverRenders(() => dynamicServer({ __html: '<b>ok</b>' }))) assert.equal(html, '<div><b>ok</b></div>');
      const dynamicClient = await compiled(`<div ${name}={v} />`, 'dom');
      for (const host of [mountH(h('div', { [name]: HOSTILE_MARKUP })), mountCompiled(dynamicClient(HOSTILE_MARKUP))]) {
        assert.equal(host.firstChild.innerHTML, '', `client parsed a string ${name}`);
      }
      assert.equal(mountCompiled(dynamicClient({ __html: '<b>ok</b>' })).firstChild.innerHTML, '<b>ok</b>');
      for (const generate of ['ssr', 'dom']) {
        assert.equal(staticError(`<div ${name}="<b>x</b>" />`, generate), 'ERR_UNSAFE_STATIC_MARKUP', `static ${name}, ${generate}`);
      }
    });
  }
});

describe('markup rules: prop names that write another attribute (ATTRIBUTE_ALIASES)', () => {
  const TAGS = { className: 'div', htmlFor: 'label', httpEquiv: 'meta', acceptCharset: 'form' };
  for (const [prop, attr] of rules.ATTRIBUTE_ALIASES) {
    const tag = TAGS[prop] || 'div';
    it(`${prop} writes ${attr}`, async () => {
      const expected = rules.VOID_ELEMENTS.has(tag) ? `<${tag} ${attr}="x">` : `<${tag} ${attr}="x"></${tag}>`;
      const staticServer = await compiled(`<${tag} ${prop}="x" />`, 'ssr');
      const dynamicServer = await compiled(`<${tag} ${prop}={v} />`, 'ssr');
      for (const html of [
        ...await serverRenders(() => h(tag, { [prop]: 'x' })),
        ...await serverRenders(() => staticServer()),
        ...await serverRenders(() => dynamicServer('x')),
      ]) assert.equal(html, expected);
      const staticClient = await compiled(`<${tag} ${prop}="x" />`, 'dom');
      const dynamicClient = await compiled(`<${tag} ${prop}={v} />`, 'dom');
      for (const host of [mountH(h(tag, { [prop]: 'x' })), mountCompiled(staticClient()), mountCompiled(dynamicClient('x'))]) {
        assert.equal(host.firstChild.getAttribute(attr), 'x', `client did not write ${attr} for ${prop}`);
      }
    });
  }
});

describe('markup rules: enumerated and boolean attributes (isEnumeratedAttr)', () => {
  for (const name of ['aria-expanded', 'role', 'data-open', 'hidden']) {
    const enumerated = rules.isEnumeratedAttr(name);
    it(`${name} is ${enumerated ? 'enumerated: true and false are written out' : 'boolean: true is bare, false omits it'}`, async () => {
      const expected = {
        true: enumerated ? `<div ${name}="true"></div>` : `<div ${name}></div>`,
        false: enumerated ? `<div ${name}="false"></div>` : '<div></div>',
      };
      const dynamicServer = await compiled(`<div ${name}={v} />`, 'ssr');
      const dynamicClient = await compiled(`<div ${name}={v} />`, 'dom');
      for (const value of [true, false]) {
        const staticServer = await compiled(`<div ${name}={${value}} />`, 'ssr');
        for (const html of [
          ...await serverRenders(() => h('div', { [name]: value })),
          ...await serverRenders(() => staticServer()),
          ...await serverRenders(() => dynamicServer(value)),
        ]) assert.equal(html, expected[value], `${name}=${value}`);
        const spread = await compiled(`<div {...v} />`, 'dom');
        for (const host of [mountH(h('div', { [name]: value })), mountCompiled(dynamicClient(value)), mountCompiled(spread({ [name]: value }))]) {
          const el = host.firstChild;
          if (enumerated) assert.equal(el.getAttribute(name), String(value), `client ${name}=${value}`);
          else assert.equal(el.hasAttribute(name), value, `client ${name}=${value}`);
        }
      }
    });
  }
});

describe('markup rules: void elements (VOID_ELEMENTS)', () => {
  for (const tag of rules.VOID_ELEMENTS) {
    it(`<${tag}> has no closing tag and no content`, async () => {
      const staticServer = await compiled(`<${tag} id="a" />`, 'ssr');
      const dynamicServer = await compiled(`<${tag} id={v} />`, 'ssr');
      for (const html of [
        ...await serverRenders(() => h(tag, { id: 'a' })),
        ...await serverRenders(() => staticServer()),
        ...await serverRenders(() => dynamicServer('a')),
      ]) assert.equal(html, `<${tag} id="a">`);
      const staticClient = await compiled(`<${tag} id="a" />`, 'dom');
      assert.equal(mountCompiled(staticClient()).innerHTML, `<${tag} id="a">`);
    });
  }
});

describe('markup rules: names written verbatim (SAFE_ATTR_NAME, SAFE_TAG_NAME)', () => {
  it('a name outside the pattern is never written by the server, and a static one does not compile', async () => {
    for (const html of await serverRenders(() => h('div', { 'x" onload="alert(1)': '' }))) assert.equal(html, '<div></div>');
    assert.throws(() => renderToString(h('div onload=alert(1)', {})), /Invalid tag name/);
    assert.equal(staticError('<div a$b="1" />', 'ssr'), 'ERR_UNSAFE_STATIC_MARKUP');
    assert.equal(staticError('<my$el />', 'ssr'), 'ERR_UNSAFE_STATIC_MARKUP');
    assert.equal(rules.SAFE_ATTR_NAME.test('a$b'), false);
    assert.equal(rules.SAFE_TAG_NAME.test('my$el'), false);
  });
});

describe('markup rules: one copy', () => {
  it('the client, the server and the compiler read the same tables', async () => {
    const { _isUnsafeAttr, _isAriaAttr } = await import('../../core/src/dom.js');
    for (const name of rules.REFUSED_ATTRS) assert.equal(_isUnsafeAttr(name, 'x'), true);
    for (const name of rules.URL_ATTRS) assert.equal(_isUnsafeAttr(name, 'javascript:x'), true);
    for (const name of ['role', 'aria-x']) assert.equal(_isAriaAttr(name), rules.isAriaAttr(name));
  });
});
