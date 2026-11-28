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
//     deferPlacedProps), so they are built where they render.
//   - JSX handed to a component in any other prop (a named slot, a boundary's
//     fallback) is lazy the same way (_$slots), and so is a prop a component
//     hands on to another. JSX that is still built before it is placed (in a
//     variable, read by a component that inspects it, given to an h()
//     component) is reported where it takes the server's place (kind
//     prebuilt), and what the user typed in a form control there is kept.

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
  ['<Head>, with body children of its own', `import { Head } from ${at('../../core/src/head.js')};`, `<Head><title>Page</title><input name="title" /><b>inside</b></Head>`],
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
        // The bodies run parent first; onMount runs children first, as React's effects do.
        assert.deepEqual(mod.seen, ['Box', 'Child', 'Child mount', 'Box mount']);
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

// Every way a component reads a named slot and hands it on. `leaf` reads the
// slot `toolbar`; at depth 2 and 3 it arrives through wrappers that hand it
// on, destructured and through props.
const SLOTS = [
  ['destructured', 'function S1({ toolbar, children }) { return <div class="s"><header>{toolbar}</header><main>{children}</main></div>; }'],
  ['props.toolbar', 'function S1(props) { return <div class="s"><header>{props.toolbar}</header><main>{props.children}</main></div>; }'],
  ['renamed', 'function S1({ toolbar: bar }) { return <div class="s"><header>{bar}</header></div>; }'],
  ['a null default', 'function S1({ toolbar = null }) { return <div class="s"><header>{toolbar}</header></div>; }'],
  ['a rest element', 'function S1({ toolbar, ...rest }) { return <div class="s" {...rest}><header>{toolbar}</header></div>; }'],
  ['destructured in the body', 'function S1(props) { const { toolbar } = props; return <div class="s"><header>{toolbar}</header></div>; }'],
  ['a logical expression', 'function S1({ toolbar }) { return <div class="s">{open() && toolbar}</div>; }'],
  ['a reactive conditional', 'function S1({ toolbar }) { return <div class="s">{open() ? toolbar : <p>closed</p>}</div>; }'],
  ['its own result', 'function S1({ toolbar }) { return toolbar; }'],
  ['a <Show>', 'function S1({ toolbar }) { return <div class="s"><Show when={open}>{toolbar}</Show></div>; }'],
  ['read twice', 'function S1({ toolbar }) { return <div class="s"><header>{toolbar}</header><footer>{toolbar}</footer></div>; }'],
  ['a boundary fallback', 'function Failed() { throw new Error("recoverable"); } function S1({ toolbar }) { return <ErrorBoundary fallback={toolbar}><Failed /></ErrorBoundary>; }'],
];
const HAND_ON = [
  '',
  'function S2({ toolbar }) { return <section class="s2"><S1 toolbar={toolbar} /></section>; }',
  'function S2({ toolbar }) { return <section class="s2"><S1 toolbar={toolbar} /></section>; } function S3(props) { return <S2 toolbar={props.toolbar} />; }',
];
const VALUES = [
  ['an element', '<input name="q" />'],
  ['a fragment', '<><input name="q" /><b>x</b></>'],
  ['a conditional', 'yes ? <input name="q" /> : null'],
];

// The server's elements, every field's early edit, the problems hydration
// reported, and the fields and elements after it.
async function hydrateEdited(source) {
  const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
  const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
  __resetHydrationData();
  document.body.innerHTML = renderToHydratableString(h(server.Page));
  const serverElements = [...document.body.querySelectorAll('*')];
  const fields = [...document.querySelectorAll('[name=q]')];
  fields.forEach((field, i) => { field.value = `typed ${i}`; });
  const problems = [];
  const stop = hydrate(h(client.Page), document.body, { onHydrationError: (info) => problems.push(info.kind) });
  return { serverElements, fields, problems, stop, after: () => [...document.querySelectorAll('[name=q]')] };
}

describe('JSX in a named prop, hydrated', () => {
  for (const [shape, leaf] of SLOTS) {
    for (const [valueName, value] of VALUES) {
      for (const depth of [1, 2, 3]) {
        it(`${valueName} slot read through ${shape}, ${depth} deep: every server node is adopted and an early edit kept`, async () => {
          const source = `
            import { Show, ErrorBoundary, signal } from 'what-framework';
            export const open = signal(true);
            const yes = true;
            ${leaf}
            ${HAND_ON[depth - 1]}
            export function Page() { return <div><S${depth} toolbar={${value}}><i>kid</i></S${depth}></div>; }`;
          const run = await hydrateEdited(source);
          try {
            assert.deepEqual(run.problems, []);
            assert.deepEqual(run.serverElements.filter((el) => !el.isConnected).map((el) => el.localName), [], 'no server element is replaced');
            assert.ok(run.fields.length > 0);
            assert.deepEqual(run.after(), run.fields, 'the server\'s fields are the page\'s');
            assert.deepEqual(run.fields.map((field) => field.value), run.fields.map((_, i) => `typed ${i}`));
          } finally {
            run.stop();
          }
        });
      }
    }
  }

  it('a slot read twice is built twice, as h() and the server render it', async () => {
    const { mount, flushSync } = await import('what-core');
    const mod = await loadCompiled(`
      function Twice({ children, toolbar }) { return <div><p>{children}{toolbar}</p><p>{children}{toolbar}</p></div>; }
      export function Page() { return <Twice toolbar={<i>t</i>}><b>x</b>y</Twice>; }`);
    const host = document.createElement('div');
    document.body.append(host);
    const stop = mount(h(mod.Page), host);
    flushSync();
    try {
      assert.equal(host.innerHTML.replace(/<!--[^>]*-->/g, ''), '<div><p><b>x</b>y<i>t</i></p><p><b>x</b>y<i>t</i></p></div>');
    } finally {
      stop();
      host.remove();
    }
  });

  it('a slot shown again is built again', async () => {
    const { mount, flushSync } = await import('what-core');
    const mod = await loadCompiled(`
      import { signal } from 'what-framework';
      export const open = signal(true);
      export const n = signal(0);
      function S({ toolbar }) { return <div>{open() && toolbar}</div>; }
      function Count() { return <i>{n()}</i>; }
      export function Page() { return <S toolbar={<><Count /><b>x</b></>} />; }`);
    const host = document.createElement('div');
    document.body.append(host);
    const stop = mount(h(mod.Page), host);
    try {
      mod.open(false);
      flushSync();
      mod.open(true);
      flushSync();
      mod.n(4);
      flushSync();
      assert.equal(host.querySelector('i')?.textContent, '4', 'the slot is back, and live');
      assert.equal(host.querySelector('b')?.textContent, 'x');
    } finally {
      stop();
      host.remove();
    }
  });

  // JSX built before it is placed takes the server's place, and says so.
  const PREBUILT = [
    ['an inspected slot', 'function S1({ toolbar }) { return <div class="s">{toolbar ? toolbar : <p>none</p>}</div>; }', '<S1 toolbar={<input name="q" />} />'],
    ['a slot given to an h() component', 'const S1 = ({ toolbar }) => h("div", { class: "s" }, toolbar);', '<S1 toolbar={<input name="q" />} />'],
    ['JSX in a variable', 'function S1({ toolbar }) { return <div class="s">{toolbar}</div>; }', '<S1 toolbar={field} />'],
    ['a checkbox and a select in an inspected slot', 'function S1({ toolbar }) { return <div class="s">{toolbar ? toolbar : null}</div>; }',
      '<S1 toolbar={<div><input name="c" type="checkbox" /><select name="s"><option value="a">A</option><option value="b">B</option></select><input name="q" /></div>} />'],
  ];
  for (const [shape, leaf, use] of PREBUILT) {
    it(`${shape}: reported as prebuilt, and what the user changed is kept`, async () => {
      const source = `
        import { h } from 'what-framework';
        ${leaf}
        export function Page() { const field = <input name="q" />; return <main>${use}</main>; }`;
      const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
      const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
      __resetHydrationData();
      document.body.innerHTML = renderToHydratableString(h(server.Page));
      document.querySelector('[name=q]').value = 'typed before hydration';
      const box = document.querySelector('[name=c]');
      if (box) {
        box.checked = true;
        document.querySelector('[name=s]').value = 'b';
      }
      const problems = [];
      const stop = hydrate(h(client.Page), document.body, { onHydrationError: (info) => problems.push(info) });
      try {
        assert.deepEqual(problems.map((p) => p.kind), ['prebuilt']);
        assert.equal(problems[0].component, 'S1', 'the component that placed it');
        assert.equal(document.querySelector('[name=q]').value, 'typed before hydration');
        if (box) {
          assert.equal(document.querySelector('[name=c]').checked, true);
          assert.equal(document.querySelector('[name=s]').value, 'b');
        }
      } finally {
        stop();
      }
    });
  }
});

// A component that returns a label and its field as a fragment, among a
// wrapper's children beside controls with bindings: a wrapper's children are
// placed where the server writes them with no markers of their own (an
// element's hole), so the field's fragment brings the only markers there.
// Before, the children's _$members took them for its own: the controls after
// the field were built again, and what the user typed or chose there before
// the page's code ran was lost (a file chosen in an upload field among them).
describe('a field component that returns a fragment, beside controls with bindings, hydrated', () => {
  const BOUND = {
    'an event handler': (name) => `<input name="${name}" onInput={(e) => e.target.setCustomValidity('')} />`,
    'a ref': (name) => `<input name="${name}" ref={(el) => el} />`,
    'a reactive attribute': (name) => `<input name="${name}" title={open() ? 'open' : 'closed'} />`,
    'bind:value': (name) => `<input name="${name}" bind:value={text} />`,
  };
  const WRAPPERS = {
    'a wrapper that destructures children': ['function Card({ children }) { return <form>{children}</form>; }', (inner) => `<Card>${inner}</Card>`],
    'a wrapper that reads props.children': ['function Card(props) { return <div class="card">{props.children}</div>; }', (inner) => `<Card>${inner}</Card>`],
    '<Form>': ['', (inner) => `<Form action="/save">${inner}</Form>`],
    '<Show>': ['', (inner) => `<Show when={open}>${inner}</Show>`],
    'a provider': ['', (inner) => `<Ctx.Provider value="v">${inner}</Ctx.Provider>`],
  };
  // Depth 2 and 3: the wrapper inside one or two components that place it.
  const OUTER = ['', 'function Outer1({ children }) { return <section>{children}</section>; }', 'function Outer2(props) { return <article><Outer1>{props.children}</Outer1></article>; }'];
  const nest = (depth, jsx) => (depth === 1 ? jsx : depth === 2 ? `<Outer1>${jsx}</Outer1>` : `<Outer2>${jsx}</Outer2>`);

  for (const [wrapperName, [wrapper, wrap]] of Object.entries(WRAPPERS)) {
    for (const depth of [1, 2, 3]) {
      it(`in ${wrapperName}, ${depth} deep: the field first, in the middle or last, beside each kind of binding`, async () => {
        for (const [bindingName, bound] of Object.entries(BOUND)) {
          for (const [position, index] of [['first', 0], ['in the middle', 1], ['last', 2]]) {
            const parts = [bound('b0'), bound('b1')];
            parts.splice(index, 0, '<Field name="f" />');
            const source = `
              import { signal, Show, createContext } from 'what-framework';
              import { Form } from ${at('../src/index.js')};
              export const open = signal(true);
              export const text = signal('bound');
              const Ctx = createContext('none');
              function Field({ name }) { return <><label>Label</label><input name={name} /></>; }
              ${wrapper}
              ${OUTER.slice(1, depth).join('\n')}
              export function Page() { return <main>${nest(depth, wrap(parts.join('')))}<button>Go</button></main>; }`;
            const label = `${bindingName}, the field ${position}`;
            const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
            const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
            __resetHydrationData();
            document.body.innerHTML = renderToHydratableString(h(server.Page));
            const serverElements = [...document.body.querySelectorAll('*')];
            const fields = [...document.querySelectorAll('input:not([type=hidden])')];
            fields.forEach((field) => { field.value = `typed ${field.name}`; });
            const problems = [];
            const stop = hydrate(h(client.Page), document.body, { onHydrationError: (info) => problems.push(`${info.kind} at ${info.path}`) });
            try {
              assert.deepEqual(problems, [], label);
              assert.deepEqual(serverElements.filter((el) => !el.isConnected).map((el) => el.localName), [], `${label}: no server element is replaced`);
              assert.equal(fields.length, 3, label);
              assert.deepEqual(fields.map((field) => field.value), fields.map((field) => `typed ${field.name}`), `${label}: every early edit is kept`);
            } finally {
              stop();
            }
          }
        }
      });
    }
  }
});

// Arrays and fragments the server brackets, or does not, as the client
// expects: each shape here hydrated with a mismatch, rebuilt nodes and lost
// edits before (round 11, V11-COR F5-F7 and the oracle's seeds), and some left
// a region that no longer updated.
describe('fragments, keyed rows and array literals, hydrated in place', () => {
  const SHAPES = {
    'a component returning a fragment that starts with a component, before <Suspense>': `function Nav() { return <nav>n</nav>; } function Header() { return <><Nav /><section>s</section></>; } export function Page() { return <main><Header /><Suspense fallback={<p>w</p>}><input name="q" /></Suspense><p class="live">{n()}</p></main>; }`,
    'the same before <ErrorBoundary>': `function Nav() { return <nav>n</nav>; } function Header() { return <><Nav /><hr /></>; } export function Page() { return <div><Header /><ErrorBoundary fallback={<p>f</p>}><input name="q" /></ErrorBoundary><p class="live">{n()}</p></div>; }`,
    'keyed rows over a plain array whose component returns a fragment': `const rows = [1, 2]; function Tag({ it }) { return <><dt>{it}</dt><dd><input name={'q' + it} /></dd></>; } export function Page() { return <main><dl>{rows.map((it) => <Tag key={it} it={it} />)}</dl><p class="live">{n()}</p></main>; }`,
    'an array literal holding <Show>, with text': `export function Page() { return <main><div>{[<b>x</b>, 'text ', <Show when={show}><i><input name="q" /></i></Show>]}</div><p class="live">{n()}</p></main>; }`,
    'an array literal holding <Show> first': `export function Page() { return <main><div>{[<Show when={show}><i><input name="q" /></i></Show>, 'text ', <b>x</b>]}</div><p class="live">{n()}</p></main>; }`,
    'an array literal holding <Show>, no text': `export function Page() { return <main><div>{[<b>x</b>, <Show when={show}><i><input name="q" /></i></Show>]}</div><p class="live">{n()}</p></main>; }`,
    'one child, a fragment whose first member is a fragment, placed in an array a component returns': `function Wrap(props) { return [<em>one</em>, props.children]; } export function Page() { return <main><Wrap><><><b>a</b><input name="q" /></><i>x</i></></Wrap><p class="live">{n()}</p></main>; }`,
    'a fragment among an element\'s children': `export function Page() { return <main><><><select name="s"><option value="a">A</option><option value="b">B</option></select></></><ErrorBoundary fallback={<p>f</p>}><input name="q" /></ErrorBoundary><p class="live">{n()}</p></main>; }`,
    'a reactive expression in a <Show> arm': `export function Page() { return <main><Show when={show}>{show() ? <Suspense fallback={<p>w</p>}><input name="q" />{n()}</Suspense> : <p>x</p>}</Show><p class="live">{n()}</p></main>; }`,
  };
  for (const [shape, page] of Object.entries(SHAPES)) {
    it(`${shape}: every server node is adopted, an early edit kept, and the page updates`, async () => {
      const source = `
        import { signal, Show, Suspense, ErrorBoundary } from 'what-framework';
        export const n = signal(0);
        export const show = signal(true);
        ${page}`;
      const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
      const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
      __resetHydrationData();
      document.body.innerHTML = renderToHydratableString(h(server.Page));
      const serverElements = [...document.body.querySelectorAll('*')];
      const fields = [...document.querySelectorAll('input, select')];
      fields.forEach((field) => { field.value = field.localName === 'select' ? 'b' : `typed ${field.name}`; });
      const problems = [];
      const errors = [];
      const { error } = console;
      console.error = (...args) => errors.push(args.join(' '));
      let stop;
      try {
        stop = hydrate(h(client.Page), document.body, { onHydrationError: (info) => problems.push(`${info.kind} at ${info.path}`) });
      } finally {
        console.error = error;
      }
      try {
        assert.deepEqual(problems, []);
        assert.deepEqual(errors, []);
        assert.deepEqual(serverElements.filter((el) => !el.isConnected).map((el) => el.localName), [], 'no server element is replaced');
        assert.deepEqual(fields.map((field) => field.value), fields.map((field) => (field.localName === 'select' ? 'b' : `typed ${field.name}`)));
        client.n(5);
        const { flushSync } = await import('what-core');
        flushSync();
        assert.equal(document.querySelector('.live').textContent, '5');
      } finally {
        stop();
        client.n(0);
      }
    });
  }
});

// JSX a .map() builds is where the .map() is: in a prop, a slot like any
// other JSX prop, built where the component places it; in a variable, built
// before it is placed, so reported where it takes the server's place. What
// the user changed in a control there goes only to the control that
// corresponds to it: the same tag, type, name and form attribute, in order
// where both trees hold as many.
describe('JSX a .map() builds, and the controls it carries to', () => {
  async function hydrated(body, edit) {
    const source = `export function Page() { ${body} }`;
    const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
    const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
    __resetHydrationData();
    globalThis.__clientSide = false;
    document.body.innerHTML = renderToHydratableString(h(server.Page));
    const before = [...document.querySelectorAll('input')];
    edit(before);
    globalThis.__clientSide = true;
    const problems = [];
    const stop = hydrate(h(client.Page), document.body, { onHydrationError: (info) => problems.push(info.kind) });
    const after = [...document.querySelectorAll('input')];
    return { problems, before, after, values: after.map((i) => [i.name, i.value]), stop };
  }
  const type = (inputs) => inputs.forEach((input) => { input.value = 'typed ' + input.name; });

  it('a .map() in a prop: built where the component places it, adopting the server\'s controls', async () => {
    const r = await hydrated(`function Rows({ rows }) { return <form>{rows}</form>; }
      return <main><Rows rows={['a', 'b'].map((k) => <input name={k} />)} /></main>;`, type);
    try {
      assert.deepEqual(r.problems, []);
      assert.deepEqual(r.after, r.before, 'the server\'s inputs are adopted');
      assert.deepEqual(r.values, [['a', 'typed a'], ['b', 'typed b']]);
    } finally { r.stop(); }
  });

  for (const [shape, body] of [
    ['a keyed .map() in a variable', `const rows = ['a', 'b'].map((k) => <input key={k} name={k} />); return <form>{rows}<p>end</p></form>;`],
    ['a .map() of components in a variable', `function I({ k }) { return <input name={k} />; } const rows = ['a', 'b'].map((k) => <I k={k} />); return <form>{rows}</form>;`],
  ]) {
    it(`${shape}: reported as prebuilt, and what the user typed is kept`, async () => {
      const r = await hydrated(body, type);
      try {
        assert.ok(r.problems.length > 0 && r.problems.every((kind) => kind === 'prebuilt'), JSON.stringify(r.problems));
        assert.deepEqual(r.values, [['a', 'typed a'], ['b', 'typed b']]);
      } finally { r.stop(); }
    });
  }

  it('a component whose output begins with text, built before it is placed, is reported too', async () => {
    const r = await hydrated(`function Note() { return <>note <i>i</i><input name="a" /></>; } const f = <Note />; return <form>{f}</form>;`, type);
    try {
      assert.deepEqual(r.problems, ['prebuilt']);
      assert.deepEqual(r.values, [['a', 'typed a']]);
    } finally { r.stop(); }
  });

  it('a control only the client renders, first: each value lands on the control of its own name', async () => {
    const r = await hydrated(`const f = <div>{globalThis.__clientSide ? <input name="extra" /> : null}<input name="a" /><input name="b" /></div>; return <form>{f}</form>;`, type);
    try {
      assert.deepEqual(r.values, [['extra', ''], ['a', 'typed a'], ['b', 'typed b']]);
    } finally { r.stop(); }
  });

  it('more controls of one name on the client than on the server: none of them gets the value, never the wrong one', async () => {
    const r = await hydrated(`const f = <div>{globalThis.__clientSide ? <input name="q" class="added" /> : null}<input name="q" /></div>; return <form>{f}</form>;`, type);
    try {
      assert.deepEqual(r.values, [['q', ''], ['q', '']]);
    } finally { r.stop(); }
  });

  it('a control of another form (its form attribute) does not take the value', async () => {
    const r = await hydrated(`const f = <div><input name="q" form={globalThis.__clientSide ? 'other' : undefined} /></div>; return <form>{f}</form>;`, type);
    try {
      assert.deepEqual(r.values, [['q', '']]);
    } finally { r.stop(); }
  });
});

process.on('exit', () => env.cleanup());
