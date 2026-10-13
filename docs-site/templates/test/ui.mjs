// Isolated UI contract fixture. These URLs are never emitted by the site build.
// Run from the framework checkout, which already includes Playwright.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { renderAgentGuide, renderGallery, renderStatusOverview, renderStatusReference } from '../render.mjs';
import { publicStatus } from '../status.mjs';

const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
const status = JSON.parse(readFileSync(new URL('../status.json', import.meta.url), 'utf8'));
const fixture = {
  version: 1,
  templates: catalog.templates.map((template, index) => ({
    ...template,
    status: 'published',
    preview: { src: `/templates/previews/${template.slug}.png`, alt: `${template.name} isolated UI fixture`, width: 1440, height: 900 },
    release: { demoUrl: `https://ui-fixture-${index}.vura.app/`, buildUrl: `https://ui-fixture-${index}.vura.app/build`, verifiedAt: '2026-09-30T16:00:00.000Z', deploymentId: '11111111-2222-3333-4444-555555555555', commitSha: 'a'.repeat(40) },
  })),
};
const files = new Map([
  ['/templates', ['text/html', renderGallery(fixture, '0.13.10')]],
  ['/templates/agents', ['text/html', renderAgentGuide(fixture, '0.13.10')]],
  ['/templates/status', ['text/html', renderStatusOverview(status, catalog, '0.13.10')]],
  ['/templates/status.json', ['application/json', JSON.stringify(publicStatus(status, catalog))]],
  ['/templates/gallery.css', ['text/css', readFileSync(new URL('../gallery.css', import.meta.url))]],
  ['/templates/gallery.js', ['text/javascript', readFileSync(new URL('../gallery.js', import.meta.url))]],
  ['/design-system.css', ['text/css', readFileSync(new URL('../../design-system.css', import.meta.url))]],
  ['/theme.js', ['text/javascript', readFileSync(new URL('../../theme.js', import.meta.url))]],
  ['/favicon.svg', ['image/svg+xml', readFileSync(new URL('../../favicon.svg', import.meta.url))]],
]);
for (const entry of status.entries) files.set(`/templates/status/${entry.slug}`, ['text/html', renderStatusReference(entry, catalog, status, '0.13.10')]);
const preview = process.env.WHAT_GALLERY_QA_PREVIEW
  ? ['image/png', readFileSync(process.env.WHAT_GALLERY_QA_PREVIEW)]
  : files.get('/favicon.svg');
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname.replace(/\/$/, '') || '/';
  const file = path.startsWith('/templates/previews/') ? preview : files.get(path);
  response.writeHead(file ? 200 : 404, { 'Content-Type': file?.[0] || 'text/plain' });
  response.end(file?.[1] || 'Not found');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let expectedStatusFailure = false;
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      if (!(expectedStatusFailure && /status of 503/.test(message.text()))) errors.push(message.text());
    }
  });
  // External fonts are not required for the local behavior checks.
  await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(`${base}/templates`);
  assert.equal(await page.title(), 'Starter templates · What Framework');
  assert.match(await page.locator('h1').innerText(), /worth building on/);
  assert.equal(await page.locator('[data-template]:visible').count(), fixture.templates.length);
  assert.equal(await page.locator('[data-gallery-controls]').isVisible(), true);
  await page.screenshot({ path: '/tmp/what-gallery-fixture-desktop.png', fullPage: false });

  await page.getByLabel('Find a starter').fill('global state');
  assert.equal(await page.locator('[data-template]:visible').count(), fixture.templates.filter(template => template.features.includes('Global state')).length);
  await page.getByRole('combobox', { name: 'Rendering model' }).selectOption('hybrid');
  const hybridGlobal = fixture.templates.filter(template => template.features.includes('Global state') && template.runtimes.includes('hybrid')).length;
  assert.equal(await page.locator('[data-template]:visible').count(), hybridGlobal);
  assert.match(await page.locator('[data-result-count]').innerText(), new RegExp(`^${hybridGlobal} starter`));
  assert.match(page.url(), /runtime=hybrid/);
  await page.getByLabel('Find a starter').fill('no matching product');
  assert.equal(await page.locator('[data-template]:visible').count(), 0);
  assert.equal(await page.locator('[data-no-matches]').isVisible(), true);
  await page.getByRole('button', { name: 'Reset filters' }).click();
  assert.equal(await page.locator('[data-template]:visible').count(), fixture.templates.length);
  assert.equal(await page.getByLabel('Find a starter').evaluate(element => element === document.activeElement), true);
  assert.equal(new URL(page.url()).search, '');

  const first = page.locator('[data-template]').first();
  await first.locator('summary').click();
  const copy = first.getByRole('button', { name: 'Copy Tempo clone commands' });
  await copy.click();
  await copy.filter({ hasText: /^Copied$/ }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /git clone https:\/\/github.com\/CelsianJs\/what-starter-tempo.git/);
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Unavailable')) } }); });
  await copy.click();
  await copy.filter({ hasText: /^Select to copy$/ }).waitFor();
  await first.screenshot({ path: '/tmp/what-gallery-fixture-card.png' });

  await page.goto(`${base}/templates?q=music&runtime=client`);
  assert.equal(await page.locator('[data-template]:visible').count(), 1);
  assert.match(await page.locator('[data-template]:visible h2').innerText(), /Oscillator/);
  await page.getByLabel('Toggle theme').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.screenshot({ path: '/tmp/what-gallery-fixture-filtered-light.png', fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/templates`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.goto(`${base}/templates/status`);
  await page.locator('[data-status-watch-message]').filter({ hasText: 'no build-status changes' }).waitFor();
  assert.equal(await page.locator('[data-status-entry]:visible').count(), status.entries.length);
  assert.notEqual(await page.locator('[data-status-last-checked]').innerText(), 'Not checked yet');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.screenshot({ path: '/tmp/what-starter-status-mobile.png', fullPage: false });
  await page.getByRole('combobox', { name: 'Build phase' }).selectOption('planned');
  assert.equal(await page.locator('[data-status-entry]:visible').count(), status.entries.filter(entry => entry.phase === 'planned').length);
  const appointmentEntry = status.entries.find(entry => entry.slug === 'what-starter-orbit');
  assert.ok(appointmentEntry, 'The appointment product is part of the status fixture');
  await page.getByRole('combobox', { name: 'Build phase' }).selectOption(appointmentEntry.phase);
  await page.getByLabel('Find a product or pattern').fill('appointment');
  assert.equal(await page.locator('[data-status-entry]:visible').count(), 1);
  await page.getByLabel('Find a product or pattern').fill('no matching product');
  await page.getByRole('button', { name: 'Reset filters' }).click();
  assert.equal(await page.locator('[data-status-entry]:visible').count(), status.entries.length);
  await page.route('**/templates/status.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...publicStatus(status, catalog), updatedAt: '2026-10-01T17:00:00.000Z' }) }));
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.locator('[data-status-watch-message]').filter({ hasText: 'no build-status changes' }).waitFor();
  await page.unroute('**/templates/status.json');
  const changed = publicStatus(status, catalog);
  changed.entries[0].summary = 'A real server-side fixture status change has arrived.';
  await page.route('**/templates/status.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(changed) }));
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.locator('[data-status-watch-message]').filter({ hasText: 'changes loaded' }).waitFor();
  assert.ok((await page.locator('.template-status-summary').allTextContents()).includes(changed.entries[0].summary));
  await page.unroute('**/templates/status.json');
  expectedStatusFailure = true;
  await page.route('**/templates/status.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  assert.match(await page.locator('[data-status-watch-message]').innerText(), /last published snapshot remains visible/);
  await page.unroute('**/templates/status.json');
  expectedStatusFailure = false;
  await context.setOffline(true);
  await page.locator('[data-status-watch-message]').filter({ hasText: 'Offline' }).waitFor();
  await context.setOffline(false);
  await page.locator('[data-status-watch-message]').filter({ hasText: /no build-status changes|changes loaded/ }).waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/what-starter-status-desktop.png', fullPage: false });
  await page.locator('[data-status-entry] h2 a').first().click();
  assert.match(await page.locator('h1').innerText(), /Tempo/);
  assert.match(await page.locator('main').innerText(), /Build journal/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/what-gallery-fixture-mobile.png', fullPage: false });
  await page.getByRole('link', { name: 'For agents', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, '/templates/agents');
  assert.match(await page.locator('h1').innerText(), /Read the pattern/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.deepEqual(errors, []);
  await context.close();

  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await noJs.newPage();
  await staticPage.goto(`${base}/templates`);
  assert.equal(await staticPage.locator('[data-template]').count(), fixture.templates.length);
  assert.equal(await staticPage.locator('[data-gallery-controls]').isVisible(), false);
  assert.equal(await staticPage.getByRole('link', { name: 'Open demo', exact: false }).count(), fixture.templates.length);
  await staticPage.goto(`${base}/templates/status`);
  assert.equal(await staticPage.locator('[data-status-entry]').count(), status.entries.length);
  assert.equal(await staticPage.locator('[data-status-watch]').isVisible(), false);
  await noJs.close();
  console.log('Gallery/status UI fixtures PASS: identity, static HTML, dynamic-count search/filtering, reset/focus, shareable query, copy success/failure, light theme, desktop/mobile, guide/journal navigation, no-JS links, no-store refresh, unchanged timestamp, actual data change, retry/offline recovery.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
