// A tag held in a binding (`const Tag = props.as; <Tag {...rest} />`, a tag
// what-compiler cannot read) is rendered by what-core as the element it names
// (render.js tagComponent). Two things it did not do:
//
// - it created every such element as HTML, so `as="circle"` in an <svg> or
//   `as="mi"` in a <math> was an unknown HTML element that did not draw. It is
//   created in the namespace of where it is placed (render.js tagElement,
//   _$inNs; the namespaces are compared with React's in
//   rest-props-react-parity.test.js);
// - while hydrating, it was built on the client instead of claiming the
//   server's element (a `not-hydratable` mismatch, the server's element
//   replaced). It claims the server's element as compiled `<a {...props}>`
//   does (render.js claimedTag).
//
// The server also rendered no children for `<Tag {...rest} />` (the props'
// children); it renders them, as the client does.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { renderToString } = await import('../../server/src/index.js');
const { h } = await import('what-framework');

const app = `
  import { signal, hydrate } from 'what-framework';
  export const text = signal('hi');
  export const r = signal(10);
  const Box = ({ as: Tag, ...rest }) => <Tag {...rest} />;
  export function App(props) {
    const Tag = props.as;
    return <main>
      <Tag id="held" title={text()}>{text()}</Tag>
      <Box as="em" className={text()}>{text()}<b>bold</b></Box>
      <svg width="40" height="40"><Box as="circle" cx="20" cy="20" r={r()} /><Box as="a" href="/l"><Box as="text" y="10">{text()}</Box></Box></svg>
      <math><Box as="mi">x</Box></math>
      <i>after</i>
    </main>;
  }
  export const run = (el, onHydrationError) => hydrate(<App as="b" />, el, { onHydrationError });
`;

async function clientBundle() {
  const dir = mkdtempSync(path.join(tmpdir(), 'what-tag-hydrate-'));
  try {
    const core = (file) => JSON.stringify(path.join(root, 'packages/core/src', file));
    const code = compileJSX(app, { production: true, pluginOptions: { hydratable: true } })
      .replace(/(['"])what-framework(\/render)?\1/g, (_, q, sub) => core(sub ? 'render.js' : 'index.js'));
    const file = path.join(dir, 'entry.mjs');
    writeFileSync(file, code);
    const out = await build({ entryPoints: [file], bundle: true, format: 'iife', globalName: 'App', write: false, logLevel: 'silent', define: { __WHAT_DEV__: 'false' } });
    return out.outputFiles[0].text;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const launches = await chromiumLaunches(chromium);

describe('a tag held in a binding: its namespace, and hydration in place', { skip: !launches && 'Chromium does not launch here' }, () => {
  let browser;
  let page;
  let serverHtml;
  const errors = [];
  before(async () => {
    const server = await loadCompiled(app, { pluginOptions: { generate: 'ssr' } });
    serverHtml = await renderToString(h(server.App, { as: 'b' }));
    browser = await chromium.launch();
    page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setContent(`<!doctype html><html><body><div id="root">${serverHtml}</div></body></html>`);
    await page.addScriptTag({ content: await clientBundle() });
  });
  after(async () => {
    await browser?.close();
  });

  it('the server renders the props\' children of a tag held in a binding', () => {
    assert.match(serverHtml, /<b id="held" title="hi">hi<\/b>/);
    assert.match(serverHtml, /<em class="hi">hi<b>bold<\/b><\/em>/);
    assert.match(serverHtml, /<a href="\/l"><text y="10">hi<\/text><\/a>/);
    assert.match(serverHtml, /<mi>x<\/mi>/);
  });

  it('hydration claims the server\'s elements, reports nothing, and the elements follow the state', async () => {
    const result = await page.evaluate(async () => {
      const rootEl = document.getElementById('root');
      const before = [...rootEl.querySelectorAll('*')];
      const reports = [];
      globalThis.App.run(rootEl, (report) => reports.push(`${report.kind} ${report.expected ?? ''}`));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const after = [...rootEl.querySelectorAll('*')];
      const kept = before.length === after.length && before.every((el, i) => el === after[i]);
      globalThis.App.text('bye');
      globalThis.App.r(15);
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        kept,
        reports,
        held: rootEl.querySelector('#held').outerHTML,
        em: rootEl.querySelector('em').outerHTML,
        r: rootEl.querySelector('circle').getAttribute('r'),
        text: rootEl.querySelector('svg text').textContent,
      };
    });
    assert.deepEqual(result.reports, []);
    assert.equal(result.kept, true, 'every element the server wrote is the one the page shows');
    assert.equal(result.held, '<b id="held" title="bye">bye</b>');
    assert.equal(result.em.replace(/<!--[^>]*-->/g, ''), '<em class="bye">bye<b>bold</b></em>');
    assert.equal(result.r, '15');
    assert.equal(result.text, 'bye');
    assert.deepEqual(errors, []);
  });

  it('a client render creates them in the namespace of where they stand, and an SVG one draws', async () => {
    const shown = await page.evaluate(() => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      // The same app, rendered on the client (no server markup to claim).
      globalThis.App.run(host, () => {});
      const circle = host.querySelector('circle');
      return {
        circle: circle.namespaceURI,
        drawn: circle.getBBox().width,
        a: host.querySelector('svg a').namespaceURI,
        mi: host.querySelector('mi').namespaceURI,
        em: host.querySelector('em').namespaceURI,
      };
    });
    assert.equal(shown.circle, 'http://www.w3.org/2000/svg');
    assert.equal(shown.drawn, 30, 'the circle is drawn at r=15');
    assert.equal(shown.a, 'http://www.w3.org/2000/svg', 'an <a> in <svg> is SVG\'s');
    assert.equal(shown.mi, 'http://www.w3.org/1998/Math/MathML');
    assert.equal(shown.em, 'http://www.w3.org/1999/xhtml');
  });
});
