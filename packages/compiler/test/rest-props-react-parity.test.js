// Rest props and polymorphic components, against real React.
//
// `const Box = ({ as: Tag, ...rest }) => <Tag {...rest} />` is the most common
// polymorphic pattern in React code (a design system's Box, Text, Button with
// `as`, a forwardRef wrapper that spreads its props). It used to read the rest
// once: what-compiler rewrote a rest element only when the pattern also had a
// prop it read where it was used, so `<Box as="a" href={url()} />` showed the
// first `href` forever. A spread onto an element also wrote `children` as an
// attribute (`<a children="one">`), and a destructured `.map()` row kept the
// first item it was built from.
//
// Each shape below is one component source, compiled twice: by what-compiler
// for What, and by esbuild's automatic JSX runtime for React 19.3.0 (the
// repository's own install, benchmark/package.json). The parent renders it,
// its state changes once, and the page each framework shows must be the same
// before and after: tags, namespaces, attributes and text.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { compileJSX } from '../../../test-utils/compile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(root, 'package.json'));
const reactVersion = require('react/package.json').version;

// `v(name)` reads a piece of the parent's state: `url()` in What, `st.url` in
// React. State before: url '/a', cls 'c1', label 'one'; after: '/bb', 'c2', 'two'.
// `rows` holds one item under key 1, replaced by a new object on the update.
const SHAPES = {
  'as tag': {
    code: `const Box = ({ as: Tag, ...rest }) => <Tag {...rest} />;`,
    use: (v) => `<Box as="a" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'as tag with a default': {
    code: `const Box = ({ as: Tag = 'a', ...rest }) => <Tag {...rest} />;`,
    use: (v) => `<Box href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'onto an element': {
    code: `const Btn = ({ variant: _v, ...rest }) => <a {...rest} />;`,
    use: (v) => `<Btn variant="x" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Btn>`,
  },
  'only a rest': {
    code: `const Btn = ({ ...rest }) => <a {...rest} />;`,
    use: (v) => `<Btn href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Btn>`,
  },
  'children outside the rest': {
    code: `const Btn = ({ children, ...rest }) => <a {...rest}>{children}</a>;`,
    use: (v) => `<Btn href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Btn>`,
  },
  'literal default': {
    code: `const Btn = ({ size = 'md', ...rest }) => <a data-size={size} {...rest} />;`,
    use: (v) => `<Btn href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Btn>`,
  },
  'array default, given': {
    code: `const List = ({ items = [], ...rest }) => <ul {...rest}>{items.map((i) => <li key={i}>{i}</li>)}</ul>;`,
    use: (v) => `<List items={${v('items')}} className={${v('cls')}} />`,
  },
  'renamed key': {
    code: `const Btn = ({ className: c, ...rest }) => <a className={'x ' + c} {...rest} />;`,
    use: (v) => `<Btn href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Btn>`,
  },
  'onto another component': {
    code: `const Inner = (props) => <a href={props.href} className={props.className}>{props.children}</a>;
      const Box = ({ as: Tag, ...rest }) => <Inner {...rest} />;`,
    use: (v) => `<Box as="x" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'as a single prop': {
    code: `const Inner = (props) => <a href={props.attrs.href} className={props.attrs.className}>{props.attrs.children}</a>;
      const Box = ({ as: Tag, ...rest }) => <Inner attrs={rest} />;`,
    use: (v) => `<Box as="x" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'destructured again': {
    code: `const Box = ({ as: Tag, ...rest }) => { const { href, ...more } = rest; return <a href={href} {...more} />; };`,
    use: (v) => `<Box as="x" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'read by key': {
    code: `const Box = ({ as: Tag, ...rest }) => <Tag href={rest.href} className={rest.className}>{rest.children}</Tag>;`,
    use: (v) => `<Box as="a" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'nested pattern': {
    code: `const Box = ({ style: { color }, ...rest }) => <a data-color={color} {...rest} />;`,
    use: (v) => `<Box style={{ color: ${v('cls')} }} href={${v('url')}}>{${v('label')}}</Box>`,
  },
  'in a nested function': {
    code: `const Box = ({ as: Tag, ...rest }) => { const render = () => <Tag {...rest} />; return render(); };`,
    use: (v) => `<Box as="a" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'destructured in a nested function': {
    code: `function Box(props) { const render = () => { const { as: Tag, ...rest } = props; return <Tag {...rest} />; }; return <div>{render()}</div>; }`,
    use: (v) => `<Box as="a" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'in a .map() row': {
    code: `const List = ({ items, ...rest }) => <ul>{items.map((i) => <li key={i}><a {...rest}>{i}</a></li>)}</ul>;`,
    use: (v) => `<List items={['p', 'q']} href={${v('url')}} className={${v('cls')}} />`,
  },
  'props spread without destructuring': {
    code: `const Box = (props) => <a {...props} />;`,
    use: (v) => `<Box href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'destructured in the body': {
    code: `function Box(props) { const { as: Tag, ...rest } = props; return <Tag {...rest} />; }`,
    use: (v) => `<Box as="a" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'function declaration': {
    code: `function Box({ as: Tag, ...rest }) { return <Tag {...rest} />; }`,
    use: (v) => `<Box as="a" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'forwardRef render function': {
    code: `const Box = fwd(({ as: Tag = 'a', ...rest }, ref) => <Tag ref={ref} {...rest} />);`,
    use: (v) => `<Box href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'a prop handed on, then spread': {
    code: `const Inner = (props) => <a {...props} />;
      const Box = (props) => <Inner href={props.href} className={props.className}>{props.children}</Inner>;`,
    use: (v) => `<Box href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'two spreads': {
    code: `const Box = ({ extra, ...rest }) => <a {...rest} {...extra} />;`,
    use: (v) => `<Box extra={{ id: 'e' }} href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'a component as the tag': {
    code: `const Link = (props) => <a href={props.href} className={props.className}>{props.children}</a>;
      const Box = ({ as: Tag, ...rest }) => <Tag {...rest} />;`,
    use: (v) => `<Box as={Link} href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Box>`,
  },
  'a tag chosen from a prop': {
    code: `const Btn = ({ href, ...rest }) => { const Tag = href ? 'a' : 'button'; return <Tag href={href} {...rest} />; };`,
    use: (v) => `<Btn href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Btn>`,
  },
  'a destructured row': {
    code: `const List = ({ rows }) => <ul>{rows.map(({ id, label }) => <li key={id}>{label}</li>)}</ul>;`,
    use: (v) => `<List rows={${v('rows')}} />`,
  },
  'a row with a rest': {
    code: `const List = ({ rows }) => <ul>{rows.map(({ id, label, ...rest }) => <li key={id} {...rest}>{label}</li>)}</ul>;`,
    use: (v) => `<List rows={${v('rows')}} />`,
  },
  'SVG tags': {
    code: `const Shape = ({ as: Tag, ...rest }) => <Tag {...rest} />;`,
    use: (v) => `<svg><Shape as="circle" r={${v('url')}.length} className={${v('cls')}} /><Shape as="a" href={${v('url')}}><Shape as="text">{${v('label')}}</Shape></Shape><foreignObject><Shape as="a" href="/h">h</Shape></foreignObject></svg>`,
  },
  'an attribute after the spread': {
    code: `const Btn = ({ variant: _v, ...rest }) => <a {...rest} href="/override" className={'own ' + rest.className} />;`,
    use: (v) => `<Btn variant="x" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Btn>`,
  },
  'children as a prop through three rests': {
    code: `const Deep3 = ({ u, ...rest }) => <a {...rest} />;
      const Deep2 = ({ u, ...rest }) => <Deep3 {...rest} />;
      const Deep1 = ({ u, ...rest }) => <Deep2 {...rest} />;`,
    use: (v) => `<Deep1 href={${v('url')}} className={${v('cls')}} children={${v('label')}} />`,
  },
  'an object spread of the rest': {
    code: `const Btn = ({ variant: _v, ...rest }) => { const merged = { ...rest, className: 'fixed' }; return <a {...merged} title={merged.href} />; };`,
    use: (v) => `<Btn variant="x" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Btn>`,
  },
  'an accessor callback over a prop': {
    code: `const Child = (props) => <i>{props.read()}</i>;
      const Box = (props) => <Child read={() => props.label} />;
      const Named = ({ label }) => <Child read={() => label} />;`,
    use: (v) => `<p><Box label={${v('label')}} /><Named label={${v('url')}} /></p>`,
  },
  'a key that reads the index': {
    code: `const List = ({ items }) => <ul>{items.map((i, n) => <li key={i + '-' + n}>{i}{n}</li>)}</ul>;`,
    use: (v) => `<List items={${v('items')}} />`,
  },
  'two spreads, the later wins': {
    code: `const Btn = ({ variant: _v, ...rest }) => <a {...rest} {...{ title: 'last', className: 'fixed' }} />;`,
    use: (v) => `<Btn variant="x" href={${v('url')}} className={${v('cls')}} title={${v('label')}}>{${v('label')}}</Btn>`,
  },
  'an attribute before a spread': {
    code: `const Btn = ({ variant: _v, ...rest }) => <a title={'own'} className={'own'} {...rest} />;`,
    use: (v) => `<Btn variant="x" href={${v('url')}} className={${v('cls')}}>{${v('label')}}</Btn>`,
  },
  'MathML tags': {
    code: `const Shape = ({ as: Tag, ...rest }) => <Tag {...rest} />;`,
    use: (v) => `<math><Shape as="mi" className={${v('cls')}}>{${v('label')}}</Shape></math>`,
  },
};

const ids = Object.keys(SHAPES);
const factories = (v) => ids.map((name, i) => `
  const App${i} = (() => {
    ${SHAPES[name].code}
    return ${v === whatRead ? '() =>' : '(st) =>'} (${SHAPES[name].use(v)});
  })();`).join('\n');

function whatRead(name) {
  return `${name}()`;
}
function reactRead(name) {
  return `st.${name}`;
}

const whatSource = `
  import { signal, batch, flushSync, mount } from 'what-framework';
  const url = signal('/a'), cls = signal('c1'), label = signal('one');
  const items = () => (label() === 'one' ? ['p', 'q'] : ['p', 'q', 'r']);
  const rows = () => [{ id: 1, label: label(), className: cls() }];
  const fwd = (render) => (props) => render(props, null);
  ${factories(whatRead)}
  export function start() {
    ${ids.map((_, i) => `mount(App${i}, document.getElementById('s${i}'));`).join('\n    ')}
  }
  export function update() {
    batch(() => { url('/bb'); cls('c2'); label('two'); });
    flushSync();
  }
`;

const reactSource = `
  import { forwardRef } from 'react';
  import { flushSync } from 'react-dom';
  import { createRoot } from 'react-dom/client';
  const fwd = forwardRef;
  const derive = (st) => ({ ...st, items: st.label === 'one' ? ['p', 'q'] : ['p', 'q', 'r'], rows: [{ id: 1, label: st.label, className: st.cls }] });
  ${factories(reactRead)}
  const apps = [${ids.map((_, i) => `App${i}`).join(', ')}];
  const roots = [];
  export function start() {
    const st = derive({ url: '/a', cls: 'c1', label: 'one' });
    apps.forEach((App, i) => {
      const r = createRoot(document.getElementById('s' + i));
      roots.push([r, App]);
      flushSync(() => r.render(App(st)));
    });
  }
  export function update() {
    const st = derive({ url: '/bb', cls: 'c2', label: 'two' });
    for (const [r, App] of roots) flushSync(() => r.render(App(st)));
  }
`;

async function bundle(code, options) {
  const dir = mkdtempSync(path.join(tmpdir(), 'what-rest-parity-'));
  try {
    const file = path.join(dir, 'entry.jsx');
    writeFileSync(file, code);
    const out = await build({ entryPoints: [file], bundle: true, format: 'iife', globalName: 'App', write: false, logLevel: 'silent',
      nodePaths: [path.join(root, 'node_modules')], ...options });
    return out.outputFiles[0].text;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const core = (file) => JSON.stringify(path.join(root, 'packages/core/src', file));
const whatBundle = () => bundle(compileJSX(whatSource, { production: true })
  .replace(/(['"])what-framework(\/render)?\1/g, (_, q, sub) => core(sub ? 'render.js' : 'index.js')), { loader: { '.jsx': 'js' }, define: { __WHAT_DEV__: 'false' } });
const reactBundle = () => bundle(reactSource, { jsx: 'automatic', jsxImportSource: 'react', define: { 'process.env.NODE_ENV': '"production"' } });

// Each shape's DOM: tags with their namespace (svg:, math:), attributes in
// name order, text, and no comments (What's region markers).
function snapshot(count) {
  const ns = { 'http://www.w3.org/2000/svg': 'svg:', 'http://www.w3.org/1998/Math/MathML': 'math:' };
  const show = (node) => {
    if (node.nodeType === 3) return node.data;
    if (node.nodeType !== 1) return '';
    const attrs = [...node.attributes].map((a) => `${a.name}="${a.value}"`).sort().join(' ');
    const inner = [...node.childNodes].map(show).join('');
    return `<${ns[node.namespaceURI] || ''}${node.localName}${attrs ? ' ' + attrs : ''}>${inner}</${node.localName}>`;
  };
  const out = [];
  for (let i = 0; i < count; i++) out.push([...document.getElementById('s' + i).childNodes].map(show).join(''));
  return out;
}

const launches = await chromiumLaunches(chromium);

describe(`rest props and polymorphic components render as React ${reactVersion} renders them`, { skip: !launches && 'Chromium does not launch here' }, () => {
  let browser;
  const seen = {};
  before(async () => {
    browser = await chromium.launch();
    for (const [name, make] of [['what', whatBundle], ['react', reactBundle]]) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.setContent(`<!doctype html><html><body>${ids.map((_, i) => `<div id="s${i}"></div>`).join('')}</body></html>`);
      await page.addScriptTag({ content: await make() });
      await page.evaluate(() => globalThis.App.start());
      const initial = await page.evaluate(snapshot, ids.length);
      await page.evaluate(() => globalThis.App.update());
      const updated = await page.evaluate(snapshot, ids.length);
      seen[name] = { initial, updated, errors };
      await page.close();
    }
  });
  after(async () => {
    await browser?.close();
  });

  it('neither page reports an error', () => {
    assert.deepEqual(seen.what.errors, []);
    assert.deepEqual(seen.react.errors, []);
  });

  ids.forEach((name, i) => {
    it(name, () => {
      assert.equal(seen.what.initial[i], seen.react.initial[i], 'first render');
      assert.equal(seen.what.updated[i], seen.react.updated[i], 'after the parent\'s state changed');
      // The shape takes the state it is handed: the update shows.
      assert.notEqual(seen.react.updated[i], seen.react.initial[i], 'React shows the new state (test sanity)');
    });
  });
});
