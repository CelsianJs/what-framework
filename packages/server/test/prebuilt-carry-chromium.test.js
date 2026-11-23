// A form built before it is placed takes the server's place while hydrating,
// and what the visitor typed or chose in its controls goes to the controls
// that correspond (render.js carryFields), never to one stored HTML wrote in
// a <noscript>. With scripting on, the browser parsed the server's
// <noscript> as text; a compiled template's inert document parses the same
// HTML with scripting off, as controls of the same names. Before, the
// visitor's password and file went to those, and the app's own controls
// stayed empty (with `form=` the secret sat in another form's control).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { installDOM } from '../../../test-utils/dom.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const browserAvailable = await chromiumLaunches(chromium);

const SOURCE = `
import { signal } from 'what-framework';
export const bio = signal('');
export function Page() {
  const form = <form id="login">
    <div class="bio" dangerouslySetInnerHTML={{ __html: bio() }} />
    <input type="password" name="password" id="pw" />
    <input type="file" name="doc" id="doc" />
  </form>;
  return <main>{form}</main>;
}`;
const BIOS = [
  ['controls of the same names in a <noscript>', '<noscript><input type="password" name="password" id="evilpw"><input type="file" name="doc" id="evildoc"></noscript><i>hello</i>'],
  ['the same, owned by another form', '<noscript><input type="password" name="password" id="evilpw" form="elsewhere"><input type="file" name="doc" id="evildoc" form="elsewhere"></noscript>'],
];

let browser = null;
let script = '';
const markup = [];

before(async () => {
  if (!browserAvailable) return;
  const env = installDOM();
  try {
    const { h } = await import('../../core/src/index.js');
    const { __resetHydrationData } = await import('../../core/src/entries/internal.js');
    const { renderToHydratableString } = await import('../src/index.js');
    const server = await loadCompiled(SOURCE, { pluginOptions: { generate: 'ssr' } });
    for (const [, bio] of BIOS) {
      server.bio(bio);
      __resetHydrationData();
      markup.push(renderToHydratableString(h(server.Page)));
    }
  } finally {
    env.cleanup();
  }
  const bundle = await build({
    stdin: {
      contents: `import { h, hydrate } from 'what-core';
        ${compileJSX(SOURCE, { pluginOptions: { hydratable: true } })}
        window.__run = (html) => {
          bio(html);
          window.__issues = [];
          hydrate(h(Page), document.body, { onHydrationError: (info) => window.__issues.push(info.kind) });
        };`,
      resolveDir: here,
      loader: 'js',
    },
    bundle: true, format: 'iife', write: false, platform: 'browser', logLevel: 'silent', conditions: ['development'],
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  script = bundle.outputFiles[0].text;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
});

describe('a prebuilt form with stored <noscript> controls, in Chromium', { skip: !browserAvailable }, () => {
  BIOS.forEach(([name, bio], i) => {
    it(`${name}: the visitor's password and file stay in the app's own controls`, async () => {
      const page = await browser.newPage();
      try {
        await page.setContent(`<!doctype html><html><body>${markup[i]}</body></html>`);
        assert.equal(await page.locator('#evilpw').count(), 0, 'the server document holds the <noscript> as text');
        await page.locator('#pw').fill('hunter2');
        await page.locator('#doc').setInputFiles({ name: 'passport.pdf', mimeType: 'application/pdf', buffer: Buffer.from('SECRET') });
        await page.addScriptTag({ content: script });
        await page.evaluate((html) => window.__run(html), bio);
        const r = await page.evaluate(() => ({
          pw: document.getElementById('pw').value,
          doc: document.getElementById('doc').files[0]?.name ?? null,
          evilpw: document.getElementById('evilpw')?.value ?? null,
          evildoc: document.getElementById('evildoc')?.files?.[0]?.name ?? null,
          issues: window.__issues,
        }));
        assert.deepEqual(r, { pw: 'hunter2', doc: 'passport.pdf', evilpw: r.evilpw === null ? null : '', evildoc: null, issues: ['prebuilt'] });
      } finally {
        await page.close();
      }
    });
  });
});
