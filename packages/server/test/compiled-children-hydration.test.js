// Children given in compiled JSX hydrate the server's nodes in place, whatever
// component places them. Compiled JSX hands a component its children unbuilt,
// built when read. A component that read them while it ran, before its own
// element had claimed its server node, made the children claim that node: a
// mismatch, and the subtree built again, which lost what the user typed or
// chose in a form before the page's code ran.
//   - The built-ins that place their children in an element of their own
//     (<Form>, <Link>, <NavLink>, <Outlet>, the a11y helpers, what-core's
//     form <Select>) take them unbuilt (`_deferChildren`) and build them where
//     they place them. <Head> takes them unbuilt too and builds them off the
//     walk: its <title>, <meta> and <link> children never render in place.
//   - A user's compiled component that only places its children, however it
//     reads them, has each read compiled where it stands (what-compiler's
//     deferPlacedChildren), so they are built where they render.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const env = installDOM();
const { h, hydrate } = await import('what-core');
const { __resetHydrationData } = await import('what-core/internal');
const { action, renderToHydratableString } = await import('../src/index.js');

globalThis.__childrenSave = action(async () => ({ saved: true }), { id: 'compiled-children/save' });
const at = (relative) => JSON.stringify(new URL(relative, import.meta.url).href);

const CASES = [
  ['<Form>', `import { Form } from ${at('../src/index.js')};`, `<Form action={save}><input name="title" /><b>Save</b></Form>`],
  ['<Link>', `import { Link } from ${at('../../router/src/index.js')};`, `<Link href="/a"><b>Go</b></Link>`],
  ['<NavLink>', `import { NavLink } from ${at('../../router/src/index.js')};`, `<NavLink href="/a"><b>Go</b></NavLink>`],
  ['<Outlet>', `import { Outlet } from ${at('../../router/src/index.js')};`, `<Outlet><b>child</b></Outlet>`],
  ['<FocusTrap>', `import { FocusTrap } from ${at('../../core/src/a11y.js')};`, `<FocusTrap active={false}><b>trap</b></FocusTrap>`],
  ['<SkipLink>', `import { SkipLink } from ${at('../../core/src/a11y.js')};`, `<SkipLink><b>skip</b></SkipLink>`],
  ['<VisuallyHidden>', `import { VisuallyHidden } from ${at('../../core/src/a11y.js')};`, `<VisuallyHidden><b>hidden</b></VisuallyHidden>`],
  ['<LiveRegion>', `import { LiveRegion } from ${at('../../core/src/a11y.js')};`, `<LiveRegion><b>live</b></LiveRegion>`],
  ['<Head>', `import { Head } from ${at('../../core/src/head.js')};`, `<Head><title>Page</title><meta name="description" content="d" /></Head><input name="title" /><b>after</b>`],
  ['<Select>', `import { Select } from ${at('../../core/src/form.js')};`, `<Select name="title"><option value="a">A</option><option value="typed before hydration">B</option></Select><b>after</b>`],
];

describe('compiled children of a built-in, hydrated', () => {
  for (const [name, imports, jsx] of CASES) {
    it(`${name}: the server's nodes are adopted, with no mismatch`, async () => {
      const source = `
        import { useActionState } from 'what-framework';
        ${imports}
        export function Page() {
          const [, save] = useActionState(globalThis.__childrenSave, null);
          return <main>${jsx}</main>;
        }`;
      const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
      const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
      __resetHydrationData();
      document.body.innerHTML = renderToHydratableString(h(server.Page));
      const b = document.querySelector('b');
      const field = document.querySelector('[name=title]');
      if (field) field.value = 'typed before hydration';
      const problems = [];
      const stop = hydrate(h(client.Page), document.body, { onHydrationError: (info) => problems.push(info.kind) });
      try {
        assert.deepEqual(problems, []);
        assert.equal(document.querySelector('b'), b, 'the server\'s child is adopted');
        if (field) {
          assert.equal(document.querySelector('[name=title]'), field);
          assert.equal(field.value, 'typed before hydration');
        }
      } finally {
        stop();
      }
    });
  }
});

// Every way a component reads and places its children. `attrs` is what a
// use of the wrapper passes it.
const WRAPPERS = [
  ['destructured', 'function W({ children }) { return <section class="w">{children}</section>; }', ''],
  ['renamed', 'function W({ children: kids }) { return <section class="w">{kids}</section>; }', ''],
  ['a null default', 'function W({ children = null }) { return <section class="w">{children}</section>; }', ''],
  ['a text default', 'function W({ children = "none" }) { return <section class="w">{children}</section>; }', ''],
  ['a rest element', 'function W({ children, ...rest }) { return <section class="w" {...rest}>{children}</section>; }', ' data-x="1"'],
  ['props.children', 'function W(props) { return <section class="w">{props.children}</section>; }', ''],
  ['destructured in the body', 'function W(props) { const { children } = props; return <section class="w">{children}</section>; }', ''],
  ['an arrow function', 'const W = ({ children }) => <section class="w">{children}</section>;', ''],
  ['a layout', 'function W({ title, children }) { return <main class="w"><h1>{title}</h1><section>{children}</section></main>; }', ' title="t"'],
  ['a fragment', 'function W({ children }) { return <><hr />{children}</>; }', ''],
  ['a logical expression', 'function W({ open, children }) { return <section class="w">{open && children}</section>; }', ' open={true}'],
  ['a conditional', 'function W({ open, children }) { return <section class="w">{open ? children : null}</section>; }', ' open={true}'],
  ['a reactive conditional', 'function W({ open, children }) { return <section class="w">{open() ? children : <p>closed</p>}</section>; }', ' open={() => true}'],
  ['an array', 'function W({ children }) { return <section class="w">{[children, "!"]}</section>; }', ''],
  ['a forward to another component', 'function In({ children }) { return <div class="in">{children}</div>; } function W({ children }) { return <In>{children}</In>; }', ''],
  ['its own result', 'function W({ children }) { return children; }', ''],
  ['a <Show>', 'function W({ open, children }) { return <section class="w"><Show when={open}>{children}</Show></section>; }', ' open={true}'],
  ['a function child', 'function W({ children }) { return <section class="w">{() => children}</section>; }', ''],
];

describe("a user's compiled wrapper, hydrated", () => {
  for (const [shape, wrapper, attrs] of WRAPPERS) {
    for (const depth of [1, 2, 3]) {
      it(`children placed through ${shape}, ${depth} deep: every server node is adopted and an early edit kept`, async () => {
        const source = `
          import { Show } from 'what-framework';
          ${wrapper}
          export function Page() {
            return <div>${`<W${attrs}>`.repeat(depth)}<input name="q" /><b>x</b>${'</W>'.repeat(depth)}</div>;
          }`;
        const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
        const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
        __resetHydrationData();
        document.body.innerHTML = renderToHydratableString(h(server.Page));
        const serverElements = [...document.body.querySelectorAll('*')];
        const field = document.querySelector('[name=q]');
        field.value = 'typed before hydration';
        const problems = [];
        const stop = hydrate(h(client.Page), document.body, { onHydrationError: (info) => problems.push(info.kind) });
        try {
          assert.deepEqual(problems, []);
          assert.deepEqual(serverElements.filter((el) => !el.isConnected).map((el) => el.localName), [], 'no server element is replaced');
          assert.equal(document.querySelector('[name=q]'), field);
          assert.equal(field.value, 'typed before hydration');
        } finally {
          stop();
        }
      });
    }
  }
});

describe('a compiled wrapper that destructures its children behaves as props.children does', () => {
  const spellings = {
    destructured: 'function Box({ open, children }) { log("Box"); onMount(() => log("Box mount")); return <section>{open() && children}</section>; }',
    'props.children': 'function Box(props) { log("Box"); onMount(() => log("Box mount")); return <section>{props.open() && props.children}</section>; }',
  };
  const page = (box) => `
    import { onMount, signal } from 'what-framework';
    export const seen = [];
    const log = (entry) => seen.push(entry);
    export const open = signal(true);
    export const n = signal(0);
    ${box}
    function Child() { log("Child"); onMount(() => log("Child mount")); return <i>{n()}</i>; }
    export function Page() { return <div><Box open={open}><Child /><b>x</b></Box></div>; }`;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  for (const [spelling, box] of Object.entries(spellings)) {
    it(`${spelling}: the wrapper runs before its children, as through h(), and children shown again are built again`, async () => {
      const { mount, flushSync } = await import('what-core');
      const mod = await loadCompiled(page(box));
      const host = document.createElement('div');
      document.body.append(host);
      const stop = mount(h(mod.Page), host);
      try {
        await settle();
        assert.deepEqual(mod.seen, ['Box', 'Child', 'Box mount', 'Child mount']);
        mod.open(false);
        flushSync();
        mod.open(true);
        flushSync();
        mod.n(5);
        flushSync();
        assert.equal(host.querySelector('section i')?.textContent, '5', 'the child is back, and live');
        assert.equal(host.querySelector('section b')?.textContent, 'x');
      } finally {
        stop();
        host.remove();
      }
    });
  }
});

// h() and the JSX runtime hand a component its children as vnodes, which
// build nothing until they are placed, so either spelling adopts. Compiled
// children handed to an h() component are built when it reads them; one that
// places them takes them unbuilt with `_deferChildren`.
describe('an h() component, hydrated', () => {
  const spellings = {
    destructured: ({ children }) => h('section', { class: 'w' }, children),
    'props.children': (props) => h('section', { class: 'w' }, props.children),
  };
  const check = async (serverPage, clientPage) => {
    __resetHydrationData();
    document.body.innerHTML = renderToHydratableString(serverPage);
    const serverElements = [...document.body.querySelectorAll('*')];
    const field = document.querySelector('[name=q]');
    field.value = 'typed before hydration';
    const problems = [];
    const stop = hydrate(clientPage, document.body, { onHydrationError: (info) => problems.push(info.kind) });
    try {
      assert.deepEqual(problems, []);
      assert.deepEqual(serverElements.filter((el) => !el.isConnected).map((el) => el.localName), []);
      assert.equal(field.value, 'typed before hydration');
    } finally {
      stop();
    }
  };

  for (const [spelling, Box] of Object.entries(spellings)) {
    it(`${spelling}, given h() children: adopted`, async () => {
      const Page = () => h('div', null, h(Box, null, h(Box, null, h('input', { name: 'q' }), h('b', null, 'x'))));
      await check(h(Page), h(Page));
    });

    it(`${spelling}, given JSX-runtime children: adopted`, async () => {
      const { jsx, jsxs } = await import('what-core/jsx-runtime');
      const Page = () => jsx('div', { children: jsx(Box, { children: jsxs(Box, { children: [jsx('input', { name: 'q' }), jsx('b', { children: 'x' })] }) }) });
      await check(h(Page), h(Page));
    });
  }

  it('given compiled children, with _deferChildren: adopted', async () => {
    const source = `
      import { h } from 'what-framework';
      const Box = Object.assign(({ children }) => h('section', { class: 'w' }, children), { _deferChildren: true });
      export function Page() { return <div><Box><Box><input name="q" /><b>x</b></Box></Box></div>; }`;
    const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
    const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
    await check(h(server.Page), h(client.Page));
  });
});

process.on('exit', () => env.cleanup());
