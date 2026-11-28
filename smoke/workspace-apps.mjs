// Offline browser smoke. The root npm ci supplies Vite, Chromium is installed
// separately, and package resolution uses the real workspace exports.
// compat-tests declares dependencies of its own, installed in its directory
// (CONTRIBUTING.md, Browser round trips and app budgets).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from '@babel/parser';
import { build } from 'vite';
import what from 'what-compiler/vite';
import { IMPORT_CHANGES } from 'what-core/internal';
import { launchBrowser } from './harness/index.mjs';
import { drive, flows } from './workspace-app-flows.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const examples = join(root, 'examples');
const budgets = process.argv.includes('--budgets');
if (budgets) process.env.NODE_ENV = 'development';
const selected = process.argv.slice(2).filter(arg => arg !== '--budgets');
// HTTPS, as a production site is served: a production server marks its CSRF
// cookie Secure, which every browser refuses from a plain-http page (Firefox
// says so in the console).
const origin = 'https://workspace.test';
const ignore = new Set(['node_modules', 'dist', 'build', 'comparison-test', 'test-results', 'test', '.git']);
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignore.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
  }
}

function auditImports(dir) {
  const offenders = [];
  const moved = new Map(IMPORT_CHANGES.map(change => [change.name, change]));
  for (const file of files(dir)) {
    if (!/\.(jsx?|tsx?|mjs)$/.test(file)) continue;
    const ast = parse(readFileSync(file, 'utf8'), { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] });
    for (const node of ast.program.body) {
      if (node.type !== 'ImportDeclaration' && node.type !== 'ExportNamedDeclaration') continue;
      const source = node.source?.value;
      if (!/^what-(core|framework)(\/|$)/.test(source ?? '')) continue;
      for (const spec of node.specifiers) {
        const imported = spec.imported ?? spec.local;
        const change = moved.get(imported?.name ?? imported?.value);
        const correctEntry = change?.to === source ||
          (change?.to?.startsWith('what-framework/') && change.to.replace('what-framework/', 'what-core/') === source);
        if (change && (change.as || !correctEntry)) {
          offenders.push(relative(dir, file) + ':' + spec.loc.start.line + ' ' + change.name + ' from ' + source);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'imports listed in docs/UPGRADING.md');
}

function staticFile(base, pathname, fallback) {
  const file = resolve(base, '.' + pathname);
  if (file !== base && !file.startsWith(base + sep)) return null;
  return [file, join(file, 'index.html'), ...(fallback && !extname(pathname) ? [join(base, 'index.html')] : [])]
    .find(candidate => existsSync(candidate) && statSync(candidate).isFile());
}

const registered = [...Object.keys(flows), 'compat-tests'];
const OWN_DEPENDENCIES = {
  'compat-tests': '`npm install --prefix examples/compat-tests --no-package-lock`',
};
assert.deepEqual(selected.filter(name => !registered.includes(name)), [], 'unknown smoke case');
const discovered = [...files(examples)]
  .filter(file => file.endsWith(sep + 'vite.config.js'))
  .map(file => relative(examples, resolve(file, '..')));
assert.deepEqual(discovered.filter(name => !registered.includes(name)), [], 'add a flow for each new Vite example');

function interactionCapture() {
  const id = 'virtual:app-interaction-capture';
  return {
    name: 'app-interaction-capture',
    resolveId: source => source === id ? '\0' + id : null,
    load(source) {
      if (source !== '\0' + id) return null;
      return `
        import { flushSync } from 'what-framework';
        import { captureDiagnostics, expectNoDiagnostics, expectRuns } from 'what-framework/testing';
        let release;
        let capture;
        window.beginInteractionCapture = () => {
          const gate = new Promise(resolve => { release = resolve; });
          capture = captureDiagnostics(() => gate);
        };
        window.endInteractionCapture = async max => {
          flushSync();
          release();
          const result = await capture;
          expectNoDiagnostics(result);
          for (const effect of Object.keys(result.runs)) expectRuns(result, { effect, max });
          const total = Object.values(result.runs).reduce((sum, runs) => sum + runs, 0);
          if (total > max) throw new Error('Effect budget ' + max + ' exceeded by ' + total + ' runs: ' + JSON.stringify(result.runs));
        };
      `;
    },
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replace('</body>', '<script type="module">import "' + id + '";</script></body>'),
    },
  };
}

async function runBuild(dir, outDir, config = {}) {
  await build({ root: dir, mode: budgets ? 'development' : 'production', logLevel: 'silent', configLoader: 'runner',
    ...(budgets ? { plugins: [interactionCapture()], define: { __WHAT_DEV__: 'true' } } : {}),
    ...config,
    build: { outDir, emptyOutDir: true, ...(budgets ? { minify: false } : {}), ...config.build },
  });
}

async function prepare(name, work) {
  const dist = join(work, 'dist');
  let shell;
  let staticRoot = dist;
  if (name.startsWith('scaffold-')) {
    const template = name.slice('scaffold-'.length);
    const dir = join(work, name);
    execFileSync(process.execPath, [join(root, 'packages/create-what/index.js'), dir, '--yes', '--template=' + template]);
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    auditImports(dir);
    if (template === 'spa') await runBuild(dir, dist);
    else if (template === 'islands') {
      execFileSync(process.execPath, ['build.js'], { cwd: dir, timeout: 45_000 });
      staticRoot = join(dir, 'dist');
    } else {
      execFileSync(process.execPath, ['build.js'], { cwd: dir, timeout: 45_000 });
      const deployed = join(dir, 'dist');
      const { default: handler } = await import(pathToFileURL(join(deployed, 'functions/_/index.js')));
      staticRoot = join(deployed, 'static');
      await runBuild(dir, staticRoot, {
        configFile: false, plugins: [what()],
        build: {
          emptyOutDir: false,
          rollupOptions: {
            input: join(dir, 'src/entry-client.js'),
            output: { entryFileNames: 'src/entry-client.js' },
          },
        },
      });
      shell = request => handler.fetch(request, {});
    }
  } else if (name === 'showcase') {
    // Buildless: serve.js serves the site and the framework's source, every
    // asset included.
    const { respond } = await import(pathToFileURL(join(root, 'sites/showcase/serve.js')));
    return {
      staticRoot: work,
      assets: true,
      shell: request => {
        const { status, type, body } = respond(new URL(request.url).pathname);
        return new Response(body, { status, headers: { 'content-type': type } });
      },
    };
  } else if (name === 'router-demo') {
    // A single module that imports what-core and what-router directly.
    const demo = join(root, 'smoke/fixtures/router-demo');
    auditImports(demo);
    symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'), 'dir');
    copyFileSync(join(demo, 'main.jsx'), join(work, 'main.jsx'));
    writeFileSync(join(work, 'index.html'), '<!doctype html><div id="app"></div><script type="module" src="/main.jsx"></script>');
    await runBuild(work, dist, { configFile: false, plugins: [what()] });
  } else {
    const dir = join(examples, name);
    auditImports(dir);
    if (name === 'blog' || name === 'shop') {
      const { createHandler } = await import(pathToFileURL(join(dir, 'server.js')));
      shell = createHandler();
      staticRoot = dir;
    } else {
      if (OWN_DEPENDENCIES[name] && !existsSync(join(dir, 'node_modules'))) {
        throw new Error(`${name} needs its own dependencies: run ${OWN_DEPENDENCIES[name]} first.`);
      }
      // The compat examples exercise their React-oriented transform.
      await runBuild(name === 'compat-tests' ? join(dir, 'src') : dir, dist, {
        configFile: join(dir, 'vite.config.js'),
      });
    }
  }
  return { staticRoot, shell };
}

async function browse(browser, name, { staticRoot, shell, assets = false }) {
  const page = await browser.newPage();
  const errors = [];
  page.setDefaultTimeout(3500);
  const missing = [];
  page.on('response', response => { if (response.status() >= 400) missing.push(response.status() + ' ' + response.url()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://fonts.googleapis.com' && route.request().resourceType() === 'stylesheet') {
        return route.fulfill({ contentType: 'text/css', body: '' });
      }
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/favicon.ico' && !existsSync(join(staticRoot, 'favicon.ico'))) {
        return route.fulfill({ status: 204, body: '' });
      }
      const file = staticFile(staticRoot, url.pathname, !shell);
      if (file) return route.fulfill({ path: file, contentType: types[extname(file)] });
      if (shell && (assets || !extname(url.pathname))) {
        // A form post reaches the app as the browser sent it: method, body,
        // and the headers the action endpoint's CSRF check reads.
        const request = route.request();
        const headers = Object.fromEntries(Object.entries(await request.allHeaders()).filter(([name]) => !name.startsWith(':')));
        const response = await shell(request.method() === 'GET'
          ? new Request(url)
          : new Request(url, { method: request.method(), headers, body: request.postData() }));
        // A fulfilled redirect is not followed for a navigation; send the
        // browser on the way a redirect would.
        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
          return route.fulfill({ status: 200, contentType: 'text/html', body: `<meta http-equiv="refresh" content="0;url=${new URL(location, url).href}">` });
        }
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
      }
      return route.fulfill({ status: 404, body: 'Missing ' + url.pathname });
    });
    const response = await page.goto(origin + '/');
    assert.equal(response.status(), 200);
    assert.deepEqual(errors, [], 'browser boot errors');
    await page.waitForFunction(() => document.body.innerText.trim().length > 0);
    if (name === 'compat-tests') {
      await page.getByRole('heading', { name: /Package Tests/ }).waitFor();
      await page.locator('#root button').first().click();
    } else {
      for (const flow of flows[name]) await drive(page, flow, budgets);
    }
    assert.deepEqual(errors, [], 'browser errors');
  } catch (error) {
    const observed = await page.locator('body').innerText({ timeout: 250 }).catch(() => '');
    throw new Error([error.message, ...errors, ...missing, 'Visible page: ' + observed.slice(0, 400)].join('\n'), { cause: error });
  } finally {
    await page.close();
  }
}

await test('workspace production builds and browser flows', { timeout: 240_000 }, async t => {
  const browser = await launchBrowser();
  try {
    const work = mkdtempSync(join(process.env.WHAT_SMOKE_TMPDIR || tmpdir(), 'what-workspace-'));
    try {
      for (const name of registered.filter(name => (!selected.length || selected.includes(name)) && (!budgets || flows[name]?.some(flow => flow.max != null)))) {
        await t.test(name, { timeout: 45_000 }, async () => {
          const dir = mkdtempSync(join(work, 'app-'));
          await browse(browser, name, await prepare(name, dir));
        });
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  } finally {
    await browser.close();
  }
});
