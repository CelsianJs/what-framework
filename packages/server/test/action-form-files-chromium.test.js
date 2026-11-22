// The sign-up form with an avatar in a real browser, written with h() and as
// compiled JSX, with JavaScript and without: a server action receives the
// file the visitor chose, whichever way the form posts. With JavaScript the
// file is chosen before the page's code has loaded, so hydration keeps it
// and the enhanced submit sends it (multipart, the state as `_state`).
// Before, the no-JS post re-rendered the page without running the action and
// the hydrated one sent the file as `{}`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const browserAvailable = await chromiumLaunches(chromium);
const { h } = await import('what-core');
const { createRequestHandler } = await import('../src/index.js');
const { toNodeListener } = await import('../src/node.js');
const { SignupPage, received } = await import('./fixtures/signup-files.js');

const fixture = path.join(here, 'fixtures/signup-files.js');
// The same JSX for both: its imports by URL for the server (a data: module),
// by path for the client bundle.
const compiledSource = (at) => `
  import { useActionState } from 'what-framework';
  import { Form } from ${JSON.stringify(at(path.join(here, '../src/index.js')))};
  import { signup } from ${JSON.stringify(at(fixture))};
  export function CompiledSignup() {
    const [state, save] = useActionState(signup, null);
    return <main><Form action={save} enctype="multipart/form-data">
      <input name="email" defaultValue={state()?.fields?.email ?? ''} />
      <input type="file" name="avatar" />
      {state()?.error ? <p role="alert">{state().error}</p> : null}
      {state()?.upload ? <output>{JSON.stringify(state().upload)}</output> : null}
      <button type="submit">Create account</button>
    </Form></main>;
  }`;

const avatar = { name: 'avatar.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') };

let server = null;
let origin = '';
let browser = null;
// Held until a test lets the page's code load.
let release = null;

before(async () => {
  if (!browserAvailable) return;
  const { CompiledSignup } = await loadCompiled(compiledSource((file) => pathToFileURL(file).href), { pluginOptions: { generate: 'ssr' } });
  const client = await build({
    stdin: {
      contents: `
        import { h, hydrate } from 'what-core';
        import { SignupPage } from ${JSON.stringify(fixture)};
        ${compileJSX(compiledSource((file) => file), { pluginOptions: { hydratable: true } })}
        hydrate(h(location.pathname === '/compiled' ? CompiledSignup : SignupPage), document.body);
        window.__hydrated = true;
      `,
      resolveDir: here,
      loader: 'js',
    },
    // One copy of each package, from its source: a dist build carries its own.
    bundle: true, format: 'esm', write: false, platform: 'browser', logLevel: 'silent', conditions: ['development'],
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  const script = client.outputFiles[0].text;
  const handle = createRequestHandler({
    routes: [
      { path: '/', component: SignupPage, page: { mode: 'server' } },
      { path: '/compiled', component: CompiledSignup, page: { mode: 'server' } },
      { path: '/welcome', component: () => h('h1', null, 'Welcome'), page: { mode: 'server' } },
    ],
    document: { clientEntry: '/client.js' },
  });
  const listener = toNodeListener(handle);
  server = http.createServer(async (req, res) => {
    if (req.url !== '/client.js') return listener(req, res);
    if (release !== null) await release;
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(script);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://localhost:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (server !== null) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

describe('a form with a file in Chromium', { skip: !browserAvailable }, () => {
  for (const [shape, route] of [['h()', '/'], ['compiled JSX', '/compiled']]) {
    for (const js of [false, true]) {
      it(`${shape}, JavaScript ${js ? 'on' : 'off'}: the action gets the file, and the form redirects once valid`, async () => {
        received.length = 0;
        const context = await browser.newContext({ javaScriptEnabled: js });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', (error) => errors.push(String(error)));
        try {
          let open = () => {};
          if (js) release = new Promise((resolve) => { open = resolve; });
          await page.goto(origin + route, { waitUntil: 'commit' });
          await page.locator('[name=email]').fill('typo');
          await page.locator('[name=avatar]').setInputFiles(avatar);
          open();
          release = null;
          if (js) await page.waitForFunction(() => window.__hydrated === true);
          const posted = page.waitForRequest((request) => request.method() === 'POST');
          await page.getByRole('button', { name: 'Create account' }).click();
          const request = await posted;
          assert.equal(new URL(request.url()).pathname, js ? '/__what_action' : route);
          assert.match(request.headers()['content-type'], /^multipart\/form-data; boundary=/);
          await page.getByRole('alert').waitFor();
          assert.equal(await page.getByRole('alert').textContent(), 'Enter a valid email');
          const shown = JSON.parse(await page.locator('output').textContent());
          assert.deepEqual(shown, { name: 'avatar.svg', size: avatar.buffer.length, text: avatar.buffer.toString() });
          assert.deepEqual(received, [shown]);
          assert.equal(await page.locator('[name=email]').inputValue(), 'typo');
          await page.locator('[name=email]').fill('name@example.test');
          await page.locator('[name=avatar]').setInputFiles(avatar);
          await page.getByRole('button', { name: 'Create account' }).click();
          await page.waitForURL(origin + '/welcome');
          assert.equal(received.length, 2);
          assert.equal(received[1].name, 'avatar.svg');
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  }
});
