// Two SSR defects that only show up where the server's own component protocol
// diverges from the client's.
//
// 1. generateStaticPage called `page.component(data)` BARE, outside the
//    component frame renderToString establishes. Nothing was on the component
//    stack, so useState/useSignal/useEffect/useMemo/useRef/onMount and
//    Context.Provider all threw. The documented entry point for static
//    generation could not render most real pages.
//
// 2. A childless component gets `undefined` for `children` on the client
//    (dom.js: `children.length === 0 ? undefined : ...`), so a JS default
//    parameter applies. The server passed `vnode.children`, which is `[]`, and
//    `[]` is defined, so the default NEVER applied server-side. A
//    server-rendered `<SkipLink />` therefore shipped a link with no accessible
//    name (WCAG 2.4.4), and the same divergence hit every component with a
//    defaulted children prop.
//
// The DOM shim is installed for the client-parity checks at the bottom. The
// server renders run through `asServer()`, which removes it, so the SSR
// assertions describe a real server and not a jsdom-flavoured one.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.CustomEvent = dom.window.CustomEvent;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const {
  h,
  mount,
  useState,
  useSignal,
  useEffect,
  useMemo,
  useRef,
  onMount,
  createContext,
  useContext,
} = await import('what-core');
const {
  generateStaticPage,
  renderToString,
  renderToHydratableString,
  renderToStream,
} = await import('../src/index.js');

// Run a render the way a real server sees it: no `document` global.
async function asServer(fn) {
  const saved = globalThis.document;
  delete globalThis.document;
  try {
    return await fn();
  } finally {
    globalThis.document = saved;
  }
}

async function streamToString(vnode) {
  let out = '';
  for await (const chunk of renderToStream(vnode)) out += chunk;
  return out;
}

// --- #40: generateStaticPage must run the page inside a component frame ---

describe('generateStaticPage renders pages that use hooks', () => {
  // One case per hook a real page is likely to reach for. Each returns 42 by a
  // different route so a silently-empty render cannot pass.
  const cases = {
    useState: () => { const [n] = useState(42); return h('p', {}, `n=${n()}`); },
    useSignal: () => { const s = useSignal(42); return h('p', {}, `n=${s()}`); },
    useMemo: () => { const m = useMemo(() => 42, []); return h('p', {}, `n=${m()}`); },
    useRef: () => { const r = useRef(42); return h('p', {}, `n=${r.current}`); },
    useEffect: () => { useEffect(() => {}, []); return h('p', {}, 'n=42'); },
    onMount: () => { onMount(() => {}); return h('p', {}, 'n=42'); },
  };

  for (const [name, Component] of Object.entries(cases)) {
    it(`generates a page whose component calls ${name}()`, async () => {
      const html = await asServer(() =>
        generateStaticPage({ component: Component, title: 'T', mode: 'static' })
      );
      assert.ok(
        html.includes('<div id="app"><p>n=42</p></div>'),
        `expected the rendered page body in the document, got:\n${html}`
      );
    });
  }

  it('generates a page whose root component holds state AND provides context', async () => {
    const Theme = createContext('light');
    const Label = () => h('p', {}, `theme=${useContext(Theme)}`);
    // The state lives in the page component's own body, which is the frame that
    // was missing. A page that only NESTS a Provider always worked, because the
    // nested vnode goes through renderToString's component branch.
    const Page = () => {
      const theme = useSignal('dark');
      return h(Theme.Provider, { value: theme() }, h(Label, {}));
    };

    const html = await asServer(() =>

      generateStaticPage({ component: Page, title: 'T', mode: 'static' })
    );
    assert.ok(
      html.includes('<div id="app"><p>theme=dark</p></div>'),
      `expected the provided context value in the body, got:\n${html}`
    );
  });

  it('still passes `data` to the page component', async () => {
    const Page = ({ name }) => h('p', {}, `hello ${name}`);
    const html = await asServer(() =>
      generateStaticPage({ component: Page, title: 'T', mode: 'static' }, { name: 'world' })
    );
    assert.ok(html.includes('<div id="app"><p>hello world</p></div>'), html);
  });

  it('keeps the document contract for a plain component (title, meta, styles, islands)', async () => {
    const page = {
      component: () => h('main', { id: 'main' }, 'body text'),
      title: 'My Page',
      meta: { description: 'A statically generated page' },
      styles: ['/a.css'],
      islands: ['Counter'],
      mode: 'static',
    };
    const html = await asServer(() => generateStaticPage(page));

    assert.ok(html.startsWith('<!DOCTYPE html>'), html);
    assert.ok(html.includes('<title>My Page</title>'), html);
    assert.ok(html.includes('<meta name="description" content="A statically generated page">'), html);
    assert.ok(html.includes('<link rel="stylesheet" href="/a.css">'), html);
    assert.ok(html.includes('hydrateIslands()'), html);
    assert.ok(html.includes('<div id="app"><main id="main">body text</main></div>'), html);
  });
});

// --- #58: a defaulted `children` prop must apply on the server too ---

// The visible instance. A childless <SkipLink /> that server-renders as
// `<a href="#main"></a>` is a link with no accessible name.
function SkipLink({ children = 'Skip to content' }) {
  return h('a', { href: '#main' }, children);
}

describe('a defaulted children prop applies on the server, as it does on the client', () => {
  it('renderToString', async () => {
    assert.equal(
      await asServer(() => renderToString(h(SkipLink, {}))),
      '<a href="#main">Skip to content</a>'
    );
  });

  it('renderToHydratableString', async () => {
    assert.equal(
      await asServer(() => renderToHydratableString(h(SkipLink, {}))),
      '<a data-hk="h0" href="#main">Skip to content</a>'
    );
  });

  it('renderToStream', async () => {
    assert.equal(
      await asServer(() => streamToString(h(SkipLink, {}))),
      '<a href="#main">Skip to content</a>'
    );
  });

  it('mount (the client path this is matching)', () => {
    const host = document.getElementById('app');
    const unmount = mount(h(SkipLink, {}), host);
    try {
      assert.equal(host.textContent, 'Skip to content');
    } finally {
      unmount();
    }
  });

  // h() collapses null/false/true children away, so <SkipLink>{null}</SkipLink>
  // is childless by the time either renderer sees it.
  it('treats a null child as childless, like the client', async () => {
    assert.equal(
      await asServer(() => renderToString(h(SkipLink, {}, null))),
      '<a href="#main">Skip to content</a>'
    );
    const host = document.getElementById('app');
    const unmount = mount(h(SkipLink, {}, null), host);
    try {
      assert.equal(host.textContent, 'Skip to content');
    } finally {
      unmount();
    }
  });

  // An empty string IS a child. `['']` has length 1, so the client passes `''`
  // and the default does not apply. The server must not "helpfully" treat an
  // empty-ish child list as absent.
  it('does not treat an empty-string child as childless, like the client', async () => {
    assert.equal(
      await asServer(() => renderToString(h(SkipLink, {}, ''))),
      '<a href="#main"></a>'
    );
    const host = document.getElementById('app');
    const unmount = mount(h(SkipLink, {}, ''), host);
    try {
      assert.equal(host.textContent, '');
    } finally {
      unmount();
    }
  });

  // A real child still wins over the default, on every path.
  it('renders real children when they are given', async () => {
    const vnode = h(SkipLink, {}, 'Jump to content');
    assert.equal(
      await asServer(() => renderToString(vnode)),
      '<a href="#main">Jump to content</a>'
    );
    assert.equal(
      await asServer(() => streamToString(vnode)),
      '<a href="#main">Jump to content</a>'
    );
    const host = document.getElementById('app');
    const unmount = mount(vnode, host);
    try {
      assert.equal(host.textContent, 'Jump to content');
    } finally {
      unmount();
    }
  });

  // children passed as a PROP rather than as a child position. The client keeps
  // it (there are no vnode children to override it with); the server used to
  // clobber it with [].
  it('keeps a children prop passed in the props object, like the client', async () => {
    const vnode = h(SkipLink, { children: 'From props' });
    assert.equal(
      await asServer(() => renderToString(vnode)),
      '<a href="#main">From props</a>'
    );
    assert.equal(
      await asServer(() => streamToString(vnode)),
      '<a href="#main">From props</a>'
    );
    const host = document.getElementById('app');
    const unmount = mount(vnode, host);
    try {
      assert.equal(host.textContent, 'From props');
    } finally {
      unmount();
    }
  });

  // A hand-built vnode (what a non-h() producer may hand the server) with no
  // children array at all must not crash the renderers.
  it('survives a vnode with no children array', async () => {
    const vnode = { tag: SkipLink, props: {}, children: undefined, key: null, _vnode: true };
    assert.equal(
      await asServer(() => renderToString(vnode)),
      '<a href="#main">Skip to content</a>'
    );
    assert.equal(
      await asServer(() => streamToString(vnode)),
      '<a href="#main">Skip to content</a>'
    );
  });
});
