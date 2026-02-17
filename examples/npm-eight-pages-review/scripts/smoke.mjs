import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4318';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console:${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror:${err.message}`));

const out = [];

async function safeStep(name, fn) {
  try {
    const result = await fn();
    out.push({ step: name, ok: true, ...result });
  } catch (err) {
    out.push({ step: name, ok: false, error: String(err.message || err) });
  }
}

await safeStep('home', async () => {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  return { h1: await page.locator('h1').first().innerText() };
});

await safeStep('signals', async () => {
  await page.goto(`${BASE_URL}/signals`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const before = await page.locator('.card p').first().innerText();
  await page.getByRole('button', { name: '+ step' }).click();
  await page.getByRole('button', { name: '+ step' }).click();
  const after = await page.locator('.card p').first().innerText();
  return { before, after };
});

await safeStep('lists', async () => {
  await page.goto(`${BASE_URL}/lists`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.getByPlaceholder('Add a todo').fill('Review release notes');
  await page.getByRole('button', { name: 'Add' }).click();
  const rowsAfterAdd = await page.locator('.stack-list .row').count();
  return { rowsAfterAdd };
});

await safeStep('forms', async () => {
  await page.goto(`${BASE_URL}/forms`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForTimeout(150);
  const errorCountAfterEmptySubmit = await page.locator('.what-error').count();
  const submitCountText = await page.locator('.panel p').nth(3).innerText();
  await page.getByPlaceholder('Ada Lovelace').fill('Ada');
  await page.getByPlaceholder('ada@example.dev').fill('ada@example.dev');
  await page.getByPlaceholder('Staff Engineer').fill('Researcher');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForTimeout(150);
  const hasSuccessCard = (await page.locator('h2', { hasText: 'Latest successful submit' }).count()) > 0;
  return { errorCountAfterEmptySubmit, submitCountText, hasSuccessCard };
});

await safeStep('data', async () => {
  await page.goto(`${BASE_URL}/data`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(500);
  const rowsBefore = await page.locator('.stack-list .row').count();
  await page.getByRole('button', { name: 'Optimistic add' }).click();
  const rowsAfterOptimistic = await page.locator('.stack-list .row').count();
  return { rowsBefore, rowsAfterOptimistic };
});

await safeStep('store', async () => {
  await page.goto(`${BASE_URL}/store`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.getByPlaceholder('Add teammate').fill('Grace');
  await page.getByRole('button', { name: 'Add' }).click();
  const rowsAfterAdd = await page.locator('.stack-list .row').count();
  await page.getByRole('button', { name: 'Offline' }).click();
  const rowsWithOfflineFilter = await page.locator('.stack-list .row').count();
  return { rowsAfterAdd, rowsWithOfflineFilter };
});

await safeStep('focus', async () => {
  await page.goto(`${BASE_URL}/focus`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.getByRole('button', { name: 'Open modal' }).click();
  const modalVisible = await page.locator('[role="dialog"]').isVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  const modalCountAfterEsc = await page.locator('[role="dialog"]').count();
  return { modalVisible, modalCountAfterEsc };
});

await safeStep('html', async () => {
  await page.goto(`${BASE_URL}/html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.getByRole('button', { name: 'Update' }).click();
  const htmlText = await page.locator('.html-box').first().innerText();
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svgRectCount = await page.locator('svg rect').count();
  return { htmlText, svgRectCount };
});

await browser.close();

console.log(JSON.stringify({ out, errors }, null, 2));

const hasStepFailure = out.some((entry) => !entry.ok);
if (hasStepFailure || errors.length > 0) {
  process.exitCode = 1;
}
