// HTML inside MathML token elements (<mi>, <mo>, <mn>, <ms>, <mtext>) and
// HTML-encoded <annotation-xml>, and inside SVG <foreignObject>, <desc> and
// <title>, is HTML: the HTML parser switches back at those integration points.
// A branch rooted there used to be annotated MathML or SVG, wrapped in <math> or
// <svg> and parsed in the wrong namespace (or thrown on in development). The
// namespace is what the browser decides, so the last test asks a real browser,
// with both the development and the production runtime.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { compileJSX } from '../../../test-utils/compile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The template each branch root compiles to: [markup, flag].
function templates(source) {
  const code = compileJSX(source);
  return [...code.matchAll(/_\$template\("((?:[^"\\]|\\.)*)"(?:, (\d))?\)/g)].map(m => [m[1], m[2] ? Number(m[2]) : 0]);
}

describe('namespace of a branch root at an integration point', () => {
  for (const token of ['mi', 'mo', 'mn', 'ms', 'mtext']) {
    it(`HTML inside <${token}> is an HTML template, not a <math>-wrapped one`, () => {
      const t = templates(`const A = () => <math><${token}>{show() && <span>{t()}</span>}</${token}></math>;`);
      assert.ok(t.some(([html, flag]) => html === '<span>' && flag === 0), JSON.stringify(t));
    });
  }

  it('<mglyph> and <malignmark> stay MathML inside a token element', () => {
    const t = templates('const A = () => <math><mtext>{show() && <mglyph />}</mtext></math>;');
    assert.ok(t.some(([html, flag]) => html === '<math><mglyph>' && flag === 2), JSON.stringify(t));
  });

  it('HTML inside an HTML-encoded <annotation-xml> is HTML; any other encoding stays MathML', () => {
    const html = templates('const A = () => <math><annotation-xml encoding="text/html">{x && <b>{y}</b>}</annotation-xml></math>;');
    assert.ok(html.some(([m, flag]) => m === '<b>' && flag === 0), JSON.stringify(html));
    const mathml = templates('const A = () => <math><annotation-xml encoding="application/mathml+xml">{x && <mi>{y}</mi>}</annotation-xml></math>;');
    assert.ok(mathml.some(([m, flag]) => m === '<math><mi>' && flag === 2), JSON.stringify(mathml));
  });

  it('HTML inside SVG <desc> and <title> is HTML, like <foreignObject>', () => {
    for (const point of ['foreignObject', 'desc', 'title']) {
      const t = templates(`const A = () => <svg><${point}>{x && <b>{y}</b>}</${point}></svg>;`);
      assert.ok(t.some(([m, flag]) => m === '<b>' && flag === 0), `${point}: ${JSON.stringify(t)}`);
    }
  });
});

const browserAvailable = await chromiumLaunches(chromium);

describe('namespace in a real browser', { skip: !browserAvailable }, () => {
  const source = `
    import { signal, mount } from 'what-framework';
    export const show = signal(true);
    export const t = signal('x');
    const A = () => <math><mtext>{show() && <span>{t()}</span>}</mtext></math>;
    const B = () => <math><mi>{show() ? <label>{t()}</label> : null}</mi></math>;
    export function run(which) {
      const box = document.createElement('div');
      document.body.appendChild(box);
      try { mount(which === 'A' ? A : B, box); } catch (e) { return 'THROW ' + e.message; }
      const el = box.querySelector(which === 'A' ? 'span' : 'label');
      return el ? el.namespaceURI + ' ' + el.textContent : 'missing: ' + box.innerHTML;
    }
  `;

  for (const dev of [true, false]) {
    it(`${dev ? 'development' : 'production'} runtime: <span> in <mtext> and <label> in <mi> are XHTML`, async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'what-mathml-'));
      const browser = await chromium.launch();
      try {
        const code = compileJSX(source, { production: !dev })
          .replace(/(['"])what-framework(\/render)?\1/g, (_, q, sub) => JSON.stringify(path.join(root, 'packages/core/src', sub ? 'render.js' : 'index.js')));
        const file = path.join(dir, 'entry.mjs');
        writeFileSync(file, code);
        const bundle = await build({ entryPoints: [file], bundle: true, format: 'iife', globalName: 'M', write: false,
          define: { __WHAT_DEV__: String(dev) }, logLevel: 'silent' });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.setContent('<!doctype html><html><body></body></html>');
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        assert.equal(await page.evaluate(() => globalThis.M.run('A')), 'http://www.w3.org/1999/xhtml x');
        assert.equal(await page.evaluate(() => globalThis.M.run('B')), 'http://www.w3.org/1999/xhtml x');
        assert.deepEqual(errors, []);
      } finally {
        await browser.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
