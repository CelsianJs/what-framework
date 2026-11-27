// The server target (`generate: "ssr"`): what each construct compiles to, the
// static values it refuses at compile time, and how compiled markup renders in
// every what-server entry point, inside and around h() trees.
//
// Byte-for-byte equality with the h() spelling of random trees is the job of
// lowering-parity-fuzz.test.js; the run-time security rules on the compiled
// path are in packages/server/test/ssr-runtime-security.test.js.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { content, keyShape, stableIds } from '../../server/test/stream-helpers.js';

const {
  renderToString, renderToHydratableString, renderToStream, renderToStringAsync, renderDocument,
} = await import('../../server/src/index.js');
const { h, createContext } = await import('../../core/src/index.js');
const { _rowKeyDigest } = await import('../../core/src/render.js');

const ssr = (source, options = {}) => compileJSX(source, { ...options, pluginOptions: { generate: 'ssr', ...options.pluginOptions } });
const load = (source) => loadCompiled(source, { pluginOptions: { generate: 'ssr' } });

async function streamed(node) {
  let html = '';
  for await (const chunk of renderToStream(node, { onError: () => {} })) html += chunk;
  return html;
}

// Each construct, the JSX and the module it compiles to. Reviewed by hand: a
// change here is a change to what ships to every server.
const GOLDEN = [
  ["static element", String.raw`const a = <div class="card"><h1>Title</h1></div>;`, String.raw`
import { ssr as _$ssr } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssr(["<div class=\"card\"><h1>Title</h1></div>"]);
const a = _tmpl$0;`],
  ["attributes and text holes", String.raw`const a = <div class="card" id={props.id} onClick={go}>Hello {name()}!</div>;`, String.raw`
import { ssr as _$ssr, ssrTemplate as _$ssrTemplate } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssrTemplate(["<div class=\"card\"", ">Hello ", "!</div>"], [["plain", "id"], null]);
const a = _$ssr(_tmpl$0, props.id, () => name());`],
  ["sole dynamic child", String.raw`const a = <h1>{title}</h1>;`, String.raw`
import { ssr as _$ssr, ssrText as _$ssrText } from "what-framework/ssr-runtime";
const _tmpl$0 = ["<h1>", "</h1>"];
const a = _$ssr(_tmpl$0, _$ssrText(title));`],
  ["function-valued attribute", String.raw`const a = <tr class={() => sel() === id ? 'danger' : ''} />;`, String.raw`
import { ssr as _$ssr, ssrTemplate as _$ssrTemplate } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssrTemplate(["<tr", "></tr>"], [["class", "class"]]);
const a = _$ssr(_tmpl$0, () => sel() === id ? 'danger' : '');`],
  ["enumerated attributes", String.raw`const a = <div aria-expanded={open()} data-x={v} role="tab" aria-hidden={false} />;`, String.raw`
import { ssr as _$ssr, ssrTemplate as _$ssrTemplate } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssrTemplate(["<div", "", " role=\"tab\" aria-hidden=\"false\"></div>"], [["enum", "aria-expanded"], ["enum", "data-x"]]);
const a = _$ssr(_tmpl$0, () => open(), v);`],
  ["url attributes", String.raw`const a = <a href={url} src="/img.png">x</a>;`, String.raw`
import { ssr as _$ssr, ssrTemplate as _$ssrTemplate } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssrTemplate(["<a", " src=\"/img.png\">x</a>"], [["url", "href"]]);
const a = _$ssr(_tmpl$0, url);`],
  ["style", String.raw`const a = <p style={{ color: c() }} />;`, String.raw`
import { ssr as _$ssr, ssrTemplate as _$ssrTemplate } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssrTemplate(["<p", "></p>"], [["style", "style"]]);
const a = _$ssr(_tmpl$0, () => ({
  color: c()
}));`],
  ["innerHTML", String.raw`const a = <div innerHTML={{ __html: x }} />;`, String.raw`
import { ssrElement as _$ssrElement } from "what-framework/ssr-runtime";
const a = _$ssrElement("div", {
  innerHTML: {
    __html: x
  }
}, null);`],
  ["spread", String.raw`const a = <div {...rest} class="x" id={id}>{child}</div>;`, String.raw`
import { ssr as _$ssr, ssrText as _$ssrText, ssrElement as _$ssrElement } from "what-framework/ssr-runtime";
const _tmpl$0 = ["", ""];
const a = _$ssrElement("div", {
  ...rest,
  class: "x",
  id: id
}, _$ssr(_tmpl$0, _$ssrText(child)));`],
  ["void element", String.raw`const a = <input disabled value={v} />;`, String.raw`
import { ssr as _$ssr, ssrTemplate as _$ssrTemplate } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssrTemplate(["<input disabled", ">"], [["plain", "value"]]);
const a = _$ssr(_tmpl$0, v);`],
  ["component with lazy children", String.raw`const a = <Card title="x" n={n()}>body <b>{x}</b></Card>;`, String.raw`
import { ssr as _$ssr, ssrText as _$ssrText, ssrComponent as _$ssrComponent } from "what-framework/ssr-runtime";
const _tmpl$0 = ["<b>", "</b>"];
const a = _$ssrComponent(Card, {
  title: "x",
  n: n()
}, ["body ", _$ssr(_tmpl$0, _$ssrText(x))], 10);`],
  ["component with no children", String.raw`const a = <Card title="x" n={n()} />;`, String.raw`
import { ssrLeaf as _$ssrLeaf } from "what-framework/ssr-runtime";
const a = _$ssrLeaf(Card, {
  title: "x",
  n: n()
}, 10);`],
  ["component spread", String.raw`const a = <C {...p} a={1} />;`, String.raw`
import { ssrComponent as _$ssrComponent } from "what-framework/ssr-runtime";
const a = _$ssrComponent(C, {
  ...p,
  a: 1
}, [], 10);`],
  ["keyed map", String.raw`const a = <ul>{items().map(it => <li key={it.id}>{it.n}</li>)}</ul>;`, String.raw`
import { ssr as _$ssr, ssrRow as _$ssrRow, ssrText as _$ssrText, ssrList as _$ssrList } from "what-framework/ssr-runtime";
const _tmpl$0 = ["<ul>", "</ul>"];
const _tmpl$1 = ["<li>", "</li>"];
const a = _$ssr(_tmpl$0, () => _$ssrList(items(), it => _$ssrRow(_tmpl$1, _$ssrText(it.n)), true, it => it.id, 15));`],
  ["conditional", String.raw`const a = <p>{ok() ? <A /> : <b>no</b>}{x && <A />}</p>;`, String.raw`
import { ssr as _$ssr, ssrText as _$ssrText, ssrLeaf as _$ssrLeaf } from "what-framework/ssr-runtime";
const _tmpl$0 = ["<p>", "", "</p>"];
const _tmpl$1 = /* @__PURE__ */_$ssr(["<b>no</b>"]);
const a = _$ssr(_tmpl$0, () => ok() ? _$ssrLeaf(A, null, 21) : _tmpl$1, _$ssrText(x && _$ssrLeaf(A, null, 45)));`],
  ["fragment", String.raw`const a = <>a{b()}<i /></>;`, String.raw`
import { ssr as _$ssr, ssrFragment as _$ssrFragment } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssr(["<i></i>"]);
const a = _$ssrFragment(["a", () => b(), _tmpl$0]);`],
  ["suspense", String.raw`import { Suspense } from 'what-framework'; const a = <Suspense fallback={<p>wait</p>}><Rows /></Suspense>;`, String.raw`
import { ssr as _$ssr, ssrComponent as _$ssrComponent, ssrLeaf as _$ssrLeaf } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssr(["<p>wait</p>"]);
import { Suspense } from 'what-framework';
const a = _$ssrComponent(Suspense, {
  fallback: _tmpl$0
}, [_$ssrLeaf(Rows, null, 86)], 53);`],
  ["island", String.raw`const a = <Counter client:idle start={1} />;`, String.raw`
import { ssrIsland as _$ssrIsland } from "what-framework/ssr-runtime";
const a = _$ssrIsland({
  component: Counter,
  mode: "idle",
  props: {
    start: 1
  }
}, []);`],
  ["show", String.raw`import { Show } from 'what-framework'; const a = <Show when={user()} fallback={<i>none</i>}><b>hi</b></Show>;`, String.raw`
import { ssr as _$ssr } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssr(["<b>hi</b>"]);
const _tmpl$1 = /* @__PURE__ */_$ssr(["<i>none</i>"]);
import { Show } from 'what-framework';
const a = () => {
  const _v$0 = user();
  return _v$0 ? _tmpl$0 : _tmpl$1;
};`],
  ["for", String.raw`import { For } from 'what-framework'; const a = <For each={rows} key={r => r.id}>{(r) => <li>{r().name}</li>}</For>;`, String.raw`
import { ssr as _$ssr, ssrFor as _$ssrFor } from "what-framework/ssr-runtime";
const _tmpl$0 = ["<li>", "</li>"];
import { For } from 'what-framework';
const a = _$ssrFor(rows, r => _$ssr(_tmpl$0, () => r().name), r => r.id, null, 48);`],
  ["list in component children", String.raw`const a = <Box>{items().map(i => <li key={i}>{i}</li>)}</Box>;`, String.raw`
import { ssrRow as _$ssrRow, ssrText as _$ssrText, ssrList as _$ssrList, ssrComponent as _$ssrComponent } from "what-framework/ssr-runtime";
const _tmpl$0 = ["<li>", "</li>"];
const a = _$ssrComponent(Box, null, [() => _$ssrList(items(), i => _$ssrRow(_tmpl$0, _$ssrText(i)), true, i => i, 16)], 10);`],
  ["switch", String.raw`import { Switch, Match } from 'what-framework'; const a = <Switch fallback={<i>none</i>}><Match when={a()}>A</Match><Match when={b()}><b>B</b></Match></Switch>;`, String.raw`
import { ssr as _$ssr } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssr(["<b>B</b>"]);
const _tmpl$1 = /* @__PURE__ */_$ssr(["<i>none</i>"]);
import { Switch, Match } from 'what-framework';
const a = () => a() ? "A" : b() ? _tmpl$0 : _tmpl$1;`],
  ["svg", String.raw`const a = <svg viewBox="0 0 1 1"><path d={d} stroke-width="2" /><text>{t}</text></svg>;`, String.raw`
import { ssrForeign as _$ssrForeign, ssrText as _$ssrText, ssrTemplate as _$ssrTemplate } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssrTemplate(["<svg viewBox=\"0 0 1 1\"><path", " stroke-width=\"2\"></path><text>", "</text></svg>"], [["plain", "d"], null]);
const a = _$ssrForeign(_tmpl$0, d, _$ssrText(t));`],
  ["bind", String.raw`const a = <input bind:value={name} />;`, String.raw`
import { ssr as _$ssr, ssrTemplate as _$ssrTemplate } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssrTemplate(["<input", ">"], [["plain", "value"]]);
const a = _$ssr(_tmpl$0, () => name());`],
  ["escaping", String.raw`const a = <p title="a&quot;b'c<d">x &amp; y {"<z>"}</p>;`, String.raw`
import { ssr as _$ssr } from "what-framework/ssr-runtime";
const _tmpl$0 = /* @__PURE__ */_$ssr(["<p title=\"a&quot;b&#39;c&lt;d\">x &amp; y &lt;z&gt;</p>"]);
const a = _tmpl$0;`],
];

describe('server target: emitted code per construct', () => {
  for (const [name, source, expected] of GOLDEN) {
    it(name, () => {
      assert.equal(ssr(source), expected.slice(1));
    });
  }

  it('hoists one template per distinct markup and dedupes repeats', () => {
    const code = ssr('const a = () => <p>{x}</p>; const b = () => <p>{y}</p>;');
    assert.equal((code.match(/const _tmpl\$\d+ =/g) || []).length, 1, code);
  });

  it('names nothing a file already uses', () => {
    const code = ssr('const _tmpl$0 = 1, _$ssr = 2, _$ssrText = 3; const a = <p>{x}</p>;');
    assert.match(code, /ssr as _\$ssr2/);
    assert.match(code, /ssrText as _\$ssrText2/);
    assert.match(code, /const _tmpl\$1 = \["<p>", "<\/p>"\]/);
  });

  it('rejects an unknown generate option', () => {
    assert.throws(() => ssr('const a = <p />;', { pluginOptions: { generate: 'html' } }), /Unknown "generate" option "html"/);
  });
});

describe('server target: unsafe static markup is a compile error', () => {
  const cases = [
    ['a javascript: href', '<a href="javascript:alert(1)">x</a>', /href="javascript:alert\(1\)" uses a javascript:/],
    ['a data: src written as a literal expression', '<img src={"data:text/html,x"} />', /src="data:text\/html,x" uses a javascript:/],
    ['a vbscript: formaction with whitespace', '<button formaction=" vbscript:x">b</button>', /formaction=" vbscript:x"/],
    ['a static srcdoc', '<iframe srcdoc="<b>x</b>"></iframe>', /srcdoc is parsed by the browser/],
    ['an uppercase static SRCDOC', '<iframe SRCDOC="x"></iframe>', /srcdoc is parsed by the browser/],
    ['a string innerHTML', '<div innerHTML="<b>x</b>" />', /innerHTML takes \{ __html: trustedString \}/],
    ['a string dangerouslySetInnerHTML', '<div dangerouslySetInnerHTML="x" />', /dangerouslySetInnerHTML takes/],
    ['an attribute name the server cannot emit', '<div a$b="1" />', /"a\$b" is not an attribute name/],
    ['a tag name the server cannot emit', '<my$el />', /<my\$el> is not a tag name/],
    ['a namespaced tag name', '<svg:rect />', /<svg:rect> is a namespaced tag name, which markup does not have\. Write <rect> inside <svg>/],
  ];
  for (const [name, jsx, message] of cases) {
    it(name, () => {
      let error = null;
      try {
        ssr(`const a = ${jsx};`, { filename: '/app/src/Page.jsx' });
      } catch (e) {
        error = e;
      }
      assert.ok(error, 'expected a compile error');
      assert.equal(error.code, 'ERR_UNSAFE_STATIC_MARKUP');
      assert.match(error.message, message);
      assert.match(error.message, /ERR_UNSAFE_STATIC_MARKUP at \/app\/src\/Page\.jsx:1:\d+: /);
      assert.match(error.message, /> 1 \| const a = /, 'the code frame points at the source line');
    });
  }

  it('leaves the same values to the run-time checks when they are dynamic', () => {
    for (const jsx of ['<a href={u} />', '<iframe srcdoc={s} />', '<div innerHTML={v} />']) {
      assert.doesNotThrow(() => ssr(`const a = ${jsx};`));
    }
  });

  // The DOM back end writes a static attribute into its template, where the
  // browser applies it as written, so the rules the client applies to a value
  // (refused props, URL schemes, innerHTML strings) hold for a static one too.
  // Names are the server's own rule: the client never writes markup from them.
  it('applies the rules the client has to the DOM target too', () => {
    for (const [jsx, message] of [
      ['<a href="javascript:void 0">x</a>', /href="javascript:void 0" uses a javascript:/],
      ['<iframe srcdoc="<b>x</b>"></iframe>', /srcdoc is parsed by the browser/],
      ['<div outerHTML="<b>x</b>" />', /outerHTML replaces the element/],
      ['<div innerHTML="<b>x</b>" />', /innerHTML takes \{ __html: trustedString \}/],
      ['<svg:rect />', /<svg:rect> is a namespaced tag name/],
    ]) {
      assert.throws(() => compileJSX(`const a = ${jsx};`), (e) => e.code === 'ERR_UNSAFE_STATIC_MARKUP' && message.test(e.message), jsx);
    }
    assert.doesNotThrow(() => compileJSX('const a = <div a$b="1"><a href="/ok" src={"data:x"}>x</a></div>;'));
  });
});

const mod = await load(`
  import { Suspense, ErrorBoundary, createResource, signal } from 'what-framework';
  export function Row(props) { return <li class={props.selected() === props.id ? 'on' : ''}>{props.id}</li>; }
  export function List(props) {
    const selected = signal(2);
    return <ul>{props.ids.map(id => <Row key={id} id={id} selected={selected} />)}</ul>;
  }
  function Slow() {
    const [v] = createResource(() => new Promise(r => setTimeout(() => r('ready'), 5)), { key: 'slow' });
    return <b>{v()}</b>;
  }
  export function Page() {
    return <main><Suspense fallback={<p>wait</p>}><Slow /></Suspense><footer>end</footer></main>;
  }
  function Broken() { throw new Error('boom'); }
  export function Guarded() {
    return <section><ErrorBoundary fallback={(e) => <i>{e.error.message}</i>}><Broken /></ErrorBoundary></section>;
  }
  export function WithChildren(props) { return <article>{props.children}</article>; }
  `);
describe('server target: renders in every entry point', () => {


  it('renderToString renders components through the vnode renderer, in document order', () => {
    assert.equal(renderToString(h(mod.List, { ids: [1, 2, 3] })),
      '<ul><li class="">1</li><li class="on">2</li><li class="">3</li></ul>');
  });

  it('renderToHydratableString writes the same keys and markers as for the h() spelling', () => {
    // props.ids.map(...) maps a value nobody proved static, so it is a
    // reactive keyed list, as the client's _$mapArray(() => props.ids) is:
    // region and list markers, the rows' keys, and each row's owner path.
    assert.equal(keyShape(renderToHydratableString(h(mod.List, { ids: [1, 2] }))),
      '<ul data-hk="0"><!--$--><!--[]--><!--k:0,1--><li data-hk="00" class="">1</li><li data-hk="01" class="on">2</li><!--/[]--><!--/$--></ul>');
  });

  it('renderToString shows a suspended boundary\'s fallback; renderToStringAsync resolves it', async () => {
    assert.equal(renderToString(h(mod.Page)), '<main><p>wait</p><footer>end</footer></main>');
    const { body, resources } = await renderToStringAsync(h(mod.Page));
    assert.equal(body, '<main data-hk="0"><!--b--><b data-hk="000"><!--$-->ready<!--/$--></b><!--/b--><footer>end</footer></main>');
    assert.equal(content(body), '<main><b>ready</b><footer>end</footer></main>');
    assert.deepEqual(resources, { slow: 'ready' });
  });

  it('renderToStream sends the shell with the fallback first and the boundary out of order', async () => {
    const chunks = [];
    for await (const chunk of renderToStream(h(mod.Page))) chunks.push(stableIds(chunk));
    assert.equal(chunks.length, 2, chunks.join('\n---\n'));
    assert.match(chunks[0], /^<main data-hk="0"><!--b--><template id="pl-wb0"><\/template><p>wait<\/p><!--pl-wb0--><!--\/b--><footer>end<\/footer><\/main>/);
    assert.match(content(chunks[1]), /<template id="wb0"><b>ready<\/b><\/template>/);
  });

  it('an <ErrorBoundary> catches a compiled child on every renderer', async () => {
    const expected = '<section><i>boom</i></section>';
    assert.equal(renderToString(h(mod.Guarded)), expected);
    // The boundary is a component whose output opens with its marker, which
    // settles its key; <!--b!--> says the server showed the fallback.
    assert.equal(renderToHydratableString(h(mod.Guarded)), '<section data-hk="0"><!--b!--><i>boom</i><!--/b--></section>');
    assert.match(await streamed(h(mod.Guarded)), /^<section data-hk="0"><!--b!--><i>boom<\/i><!--\/b--><\/section>/);
  });

  it('renderDocument renders a compiled page module with its resources', async () => {
    const html = await renderDocument({ default: mod.Page });
    assert.match(content(html), /<body><main><b>ready<\/b><footer>end<\/footer><\/main><script id="__what_data"/);
    assert.match(html, /"slow":"ready"/);
  });

  it('nests h() trees in compiled markup and compiled markup in h() trees', async () => {
    const hTree = h('aside', { title: 'h' }, h('em', null, 'inner'));
    const html = renderToString(h(mod.WithChildren, null, hTree, 'text'));
    assert.equal(html, '<article><aside title="h"><em>inner</em></aside>text</article>');
    const outer = h('div', { id: 'outer' }, h(mod.List, { ids: [1] }), () => h(mod.WithChildren, null, 'x'));
    assert.equal(renderToString(outer), '<div id="outer"><ul><li class="">1</li></ul><article>x</article></div>');
    assert.equal(keyShape(await streamed(outer)), '<div id="outer"><ul data-hk="0"><!--$--><!--[]--><!--k:0--><li data-hk="00" class="">1</li><!--/[]--><!--/$--></ul><!--$--><article data-hk="1">x</article><!--/$--></div>');
  });

  it('a compiled root built before the render renders inside it, with the render\'s context', async () => {
    const Ctx = createContext('outside');
    const reader = await load(`
      import { useContext } from 'what-framework';
      export function make(Ctx) { function Read() { return <b>{useContext(Ctx)}</b>; } return <Read />; }
    `);
    const tree = reader.make(Ctx);
    assert.equal(renderToString(h(Ctx.Provider, { value: 'inside' }, tree)), '<b>inside</b>');
    assert.equal(renderToString(tree), '<b>outside</b>');
  });
});

const flow = await load(`
    import { Show, For, Switch, Match } from 'what-framework';
    export const show = (user) => <div><Show when={user} fallback={<i>none</i>}>{(u) => <b>{u.name}</b>}</Show></div>;
    export const keyed = (rows) => <ul><For each={rows} key={(r) => r.id} fallback={<li>empty</li>}>{(r) => <li>{r().name}</li>}</For></ul>;
    export const plain = (rows) => <ul><For each={() => rows}>{(r, i) => <li>{i}:{r}</li>}</For></ul>;
    export const pick = (n) => <p><Switch fallback={<i>other</i>}><Match when={n === 1}>one</Match><Match when={n === 2}><b>two</b></Match></Switch></p>;
  `);
describe('server target: control flow', () => {


  it('<Show> renders the arm its condition picks, with the value', () => {
    assert.equal(renderToString(flow.show({ name: 'Ada' })), '<div><b>Ada</b></div>');
    assert.equal(renderToString(flow.show(null)), '<div><i>none</i></div>');
  });

  it('<For> renders its rows (accessors when keyed) or its fallback', async () => {
    assert.equal(renderToString(flow.keyed([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])), '<ul><li>a</li><li>b</li></ul>');
    assert.equal(renderToString(flow.keyed([])), '<ul><li>empty</li></ul>');
    assert.equal(renderToString(flow.plain(['x', 'y'])), '<ul><li>0:x</li><li>1:y</li></ul>');
    assert.equal(renderToHydratableString(flow.plain(['x'])), '<ul><!--$--><!--[]--><li>0:x</li><!--/[]--><!--/$--></ul>');
    const keyed = await streamed(flow.keyed([{ id: 1, name: 'a' }]));
    const salt = /<!--k:([^:>]+):/.exec(keyed)[1];
    assert.equal(keyed, `<ul><!--$--><!--[]--><!--k:${salt}:${_rowKeyDigest(1, salt)}--><li><!--$-->a<!--/$--></li><!--/[]--><!--/$--></ul>`);
  });

  it('<Switch> renders the first matching arm or the fallback', () => {
    assert.equal(renderToString(flow.pick(1)), '<p>one</p>');
    assert.equal(renderToString(flow.pick(2)), '<p><b>two</b></p>');
    assert.equal(renderToString(flow.pick(3)), '<p><i>other</i></p>');
  });
});
