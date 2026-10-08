import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, cp, symlink, readFile, writeFile, realpath, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { pkgs, sortOrder } from '../../../sites/react-compat/src/data.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const site = join(repo, 'sites/react-compat');
// Root npm ci installs these tools (Vite is the locked benchmark workspace
// dependency). Never depend on an untracked install inside the marketing site.
const require = createRequire(join(repo, 'package.json'));
const viteUrl = pathToFileURL(require.resolve('vite')).href;
const babelUrl = pathToFileURL(require.resolve('@babel/core')).href;
const { build, preview } = await import(viteUrl);
let work;
let server;
let browser;
let url;

before(async () => {
  // Default: current workspace packages, keeping pre-release CI hermetic.
  // Release QA can point this at a clean registry install of the site's pins.
  const packageRoot = await realpath(process.env.WHAT_REACT_MARKETING_PACKAGE_ROOT || repo);
  work = await realpath(await mkdtemp(join(tmpdir(), 'what-react-marketing-')));
  const fixture = join(work, 'site');
  await cp(site, fixture, {
    recursive: true,
    filter: path => !['node_modules', 'dist', '.vercel'].includes(basename(path)),
  });
  await symlink(join(packageRoot, 'node_modules'), join(fixture, 'node_modules'), 'dir');
  // Keep the site's actual Babel/Vite pipeline. Only tool resolution moves to
  // existing test dependencies; app/package imports use packageRoot above.
  const config = join(fixture, 'vite.config.js');
  const source = await readFile(config, 'utf8');
  await writeFile(config, source
    .replace("from 'vite'", `from ${JSON.stringify(viteUrl)}`)
    .replace("from '@babel/core'", `from ${JSON.stringify(babelUrl)}`));
  await build({ root: fixture, configFile: config, configLoader: 'native', logLevel: 'silent' });
  server = await preview({
    root: fixture,
    configFile: false,
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 0 },
  });
  url = `http://127.0.0.1:${server.httpServer.address().port}`;
  // Missing Chromium fails rather than skipping the regression. CI already
  // provisions it for the other qualification/browser suites.
  browser = await chromium.launch();
}, { timeout: 60_000 });

after(async () => {
  try {
    await browser?.close();
  } finally {
    try {
      if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    } finally {
      if (work) await rm(work, { recursive: true, force: true });
    }
  }
});

function expectedPackages(category) {
  return (category === 'All' ? pkgs : pkgs.filter(pkg => pkg.c === category))
    .slice().sort((a, b) => (sortOrder[a.s] ?? 9) - (sortOrder[b.s] ?? 9));
}

for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 1000 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  test(`built React marketing catalogue and filters work on ${name}`, { timeout: 30_000 }, async t => {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    // External fonts are not part of the application contract; keep browser
    // qualification deterministic even when Google's font service is offline.
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    try {
      await page.goto(url);
      assert.match(await page.title(), /what-react.*React Compatibility Layer/);
      assert.match(await page.locator('h1').innerText(), /Your React Libraries/);
      assert.equal(await page.locator('vite-error-overlay, what-error-overlay').count(), 0);
      assert.equal(pkgs.length, 94, 'exercise the authored catalogue, not placeholder data');
      t.diagnostic(`${name}: initial cards ${await page.locator('.pkg-card').count()}, active filters ${JSON.stringify(await page.locator('.filter-btn.active').allTextContents())}`);

      let first = true;
      for (const [category, count] of [['All', 94], ['State Management', 5], ['Forms', 8], ['All', 94]]) {
        if (!first) {
          await page.getByRole('button', { name: `${category} (${count})`, exact: true }).click();
        }
        first = false;
        await page.waitForFunction(expected => document.querySelectorAll('.pkg-card').length === expected, count, { timeout: 5_000 });
        const authored = expectedPackages(category);
        assert.deepEqual(await page.locator('.pkg-card .pkg-name').allTextContents(), authored.map(pkg => pkg.n));
        assert.deepEqual(await page.locator('.pkg-card .pkg-note').allTextContents(), authored.map(pkg => pkg.t));
        assert.deepEqual(await page.locator('.filter-btn.active').allTextContents(), [`${category} (${count})`]);
        await page.waitForFunction(() => [...document.querySelectorAll('.pkg-card')].every(card =>
          Number(getComputedStyle(card).opacity) >= (card.classList.contains('investigating') ? 0.54 : 0.99)),
        null, { timeout: 5_000 });
        t.diagnostic(`${name}: ${category} selected, ${count} authored packages visible`);
      }

      const numbers = page.locator('.stat-number');
      const expected = [String(pkgs.filter(pkg => pkg.s === 'pass').length), String(pkgs.length), '0', '500M+'];
      for (let index = 0; index < expected.length; index++) {
        await numbers.nth(index).scrollIntoViewIfNeeded();
        await page.waitForFunction(({ index, text }) => document.querySelectorAll('.stat-number')[index]?.textContent === text,
          { index, text: expected[index] }, { timeout: 5_000 });
      }
      assert.deepEqual(await numbers.allTextContents(), expected);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'the repaired catalogue must not overflow the viewport horizontally');
      assert.deepEqual(errors, [], 'no app runtime errors, warnings or framework overlay');
      if (process.env.WHAT_REACT_MARKETING_SCREENSHOT_DIR) {
        await mkdir(process.env.WHAT_REACT_MARKETING_SCREENSHOT_DIR, { recursive: true });
        await page.locator('#packages').scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(process.env.WHAT_REACT_MARKETING_SCREENSHOT_DIR, `react-catalog-${name}.png`) });
      }
      t.diagnostic(`${name}: stats ${expected.join(', ')}; no runtime warnings/errors`);
    } finally {
      await page.close();
    }
  });
}
