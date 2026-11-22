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
  import { ErrorBoundary, useActionState } from 'what-framework';
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
  }
  // The upload recipe (server README, docs/DATA.md): a size check on the file
  // input, and the form's component in a boundary that names the limit (an
  // action's error reaches the boundary above the component whose
  // useActionState dispatched it). \`check\` false leaves the check out, so
  // the server's limit answers.
  const MAX_UPLOAD = 32 * 1024;
  function Upload({ check }) {
    const [state, save] = useActionState(signup, null);
    return <Form action={save} enctype="multipart/form-data">
      <input name="email" defaultValue={state()?.fields?.email ?? ''} />
      <input type="file" name="avatar" onChange={(e) => {
        const file = e.target.files[0];
        if (check) e.target.setCustomValidity(file && file.size > MAX_UPLOAD ? 'Choose a file under 32 KB' : '');
      }} />
      <button type="submit">Create account</button>
    </Form>;
  }
  function Recipe({ check }) {
    return <main><ErrorBoundary fallback={({ error, reset }) => (
      <p role="alert">
        {error.code === 'ERR_PAYLOAD_TOO_LARGE' ? \`Too large: the limit is \${error.limit} bytes.\` : error.message}
        <button onClick={reset}>Try again</button>
      </p>
    )}>
      <Upload check={check} />
    </ErrorBoundary></main>;
  }
  export function CheckedRecipe() { return <Recipe check={true} />; }
  export function BoundaryRecipe() { return <Recipe check={false} />; }
  // A field built before it is placed (an inspected prop): it takes the
  // server's place while hydrating, with the file chosen in the server's.
  function Inspecting({ field }) { return <div class="inspecting">{field ? field : null}</div>; }
  export function InspectedUpload() { return <main><Inspecting field={<input type="file" name="avatar" />} /></main>; }`;

const avatar = { name: 'avatar.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') };

let server = null;
let origin = '';
let browser = null;
// Held until a test lets the page's code load.
let release = null;

before(async () => {
  if (!browserAvailable) return;
  const { CompiledSignup, CheckedRecipe, BoundaryRecipe, InspectedUpload } = await loadCompiled(compiledSource((file) => pathToFileURL(file).href), { pluginOptions: { generate: 'ssr' } });
  const client = await build({
    stdin: {
      contents: `
        import { h, hydrate } from 'what-core';
        import { SignupPage } from ${JSON.stringify(fixture)};
        ${compileJSX(compiledSource((file) => file), { pluginOptions: { hydratable: true } })}
        const pages = { '/compiled': CompiledSignup, '/recipe': CheckedRecipe, '/boundary': BoundaryRecipe, '/inspected': InspectedUpload };
        window.__problems = [];
        hydrate(h(pages[location.pathname] ?? SignupPage), document.body, { onHydrationError: (info) => window.__problems.push(info.kind) });
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
      { path: '/recipe', component: CheckedRecipe, page: { mode: 'server' } },
      { path: '/boundary', component: BoundaryRecipe, page: { mode: 'server' } },
      { path: '/inspected', component: InspectedUpload, page: { mode: 'server' } },
      { path: '/welcome', component: () => h('h1', null, 'Welcome'), page: { mode: 'server' } },
    ],
    document: { clientEntry: '/client.js' },
    bodyLimit: 64 * 1024,
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

// A file over the limit, with JavaScript: the visitor is told, and keeps what
// they typed.
describe('the upload recipe in Chromium, a file over the limit', { skip: !browserAvailable }, () => {
  const big = (bytes) => ({ name: 'photo.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(bytes, 120) });
  const open = async (route) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(origin + route);
    await page.waitForFunction(() => window.__hydrated === true);
    return { context, page, errors };
  };

  it('the size check refuses it before the form is sent, naming the limit, and the form keeps the typed email', async () => {
    received.length = 0;
    const { context, page, errors } = await open('/recipe');
    try {
      const posts = [];
      page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()); });
      await page.locator('[name=email]').fill('name@example.test');
      await page.locator('[name=avatar]').setInputFiles(big(40 * 1024));
      await page.getByRole('button', { name: 'Create account' }).click();
      assert.equal(await page.locator('[name=avatar]').evaluate((input) => input.validationMessage), 'Choose a file under 32 KB');
      assert.deepEqual(posts, [], 'nothing is sent');
      assert.equal(await page.locator('[name=email]').inputValue(), 'name@example.test');
      assert.deepEqual(received, []);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });

  it('without the check, the server refuses it and the boundary names the limit', async () => {
    received.length = 0;
    const { context, page, errors } = await open('/boundary');
    try {
      await page.locator('[name=email]').fill('name@example.test');
      await page.locator('[name=avatar]').setInputFiles(big(80 * 1024));
      const answered = page.waitForResponse((response) => response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Create account' }).click();
      assert.equal((await answered).status(), 413);
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').textContent(), /Too large: the limit is 65536 bytes\./);
      assert.deepEqual(received, [], 'the action did not run');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  });
});

describe('a file input built before it is placed, in Chromium', { skip: !browserAvailable }, () => {
  it('takes the server field\'s place, reported as prebuilt, with the file the visitor chose', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    try {
      let open = () => {};
      release = new Promise((resolve) => { open = resolve; });
      await page.goto(origin + '/inspected', { waitUntil: 'commit' });
      await page.locator('[name=avatar]').setInputFiles(avatar);
      await page.locator('[name=avatar]').evaluate((input) => { window.__server = input; });
      open();
      release = null;
      await page.waitForFunction(() => window.__hydrated === true);
      const after = await page.evaluate(() => {
        const input = document.querySelector('[name=avatar]');
        return { same: input === window.__server, files: [...input.files].map((f) => f.name), problems: window.__problems };
      });
      assert.deepEqual(after, { same: false, files: ['avatar.svg'], problems: ['prebuilt'] });
    } finally {
      await context.close();
    }
  });
});
