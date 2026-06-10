import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Ephemeral OS-assigned port (see before hook) — a fixed port made the suite
// cancel itself whenever a concurrent test run (or stale server) held it.
let URL;

let viteServer;
let browser;
let page;

// Skip gracefully when the Playwright browser isn't installed (e.g. a fresh
// `npm test` without `npx playwright install chromium`). Without this guard
// the `before` hook throws and node:test cancels every subtest with
// "test did not finish before its parent and was cancelled", which poisons
// the whole repo's test output. Mirrors devtools-mcp/test/e2e.test.js.
let browserAvailable = false;
try {
  browserAvailable = existsSync(chromium.executablePath());
} catch {
  browserAvailable = false;
}
const browserDescribe = browserAvailable ? describe : describe.skip;
if (!browserAvailable) {
  console.warn('[what] Skipping devtools browser tests: Chromium not installed (run `npx playwright install chromium`).');
}

// Helper: safely extract snapshot data without circular refs
const safeSnapshot = `(() => {
  const snap = window.__WHAT_DEVTOOLS__.getSnapshot();
  return {
    signalCount: snap.signals.length,
    effectCount: snap.effects.length,
    componentCount: snap.components.length,
    signalNames: snap.signals.map(s => s.name),
    effectNames: snap.effects.map(s => s.name),
  };
})()`;

browserDescribe('what-devtools', () => {
  before(async () => {
    // Start Vite dev server in-process (no child process to orphan: the old
    // `spawn('npx', ['vite', ...])` setup could hang teardown forever when the
    // process exited before `after` attached its 'exit' listener).
    viteServer = await createServer({
      configFile: resolve(__dirname, 'vite.config.js'),
      logLevel: 'silent',
      // Ephemeral port: collision-proof under parallel `npm test` runs.
      server: { port: 0, strictPort: false },
    });
    await viteServer.listen();
    const port = viteServer.httpServer.address().port;
    URL = `http://localhost:${port}/fixture.html`;

    // Launch browser
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  after(async () => {
    if (browser) await browser.close();
    if (viteServer) await viteServer.close();
  });

  test('app renders and devtools install', async () => {
    await page.goto(URL);
    await page.waitForSelector('#title');

    const title = await page.textContent('#title');
    assert.strictEqual(title, 'DevTools Test App');

    // __WHAT_DEVTOOLS__ should be exposed on window
    const hasDevtools = await page.evaluate(() => !!window.__WHAT_DEVTOOLS__);
    assert.strictEqual(hasDevtools, true);
  });

  test('devtools track signals', async () => {
    await page.goto(URL);
    await page.waitForSelector('#title');
    await page.waitForTimeout(200);

    const snap = await page.evaluate(safeSnapshot);

    // Should have tracked signals (count, name, items + DevPanel internal ones)
    assert.ok(snap.signalCount >= 3, `Expected >= 3 signals, got ${snap.signalCount}`);
  });

  test('devtools track effects', async () => {
    await page.goto(URL);
    await page.waitForSelector('#title');
    await page.waitForTimeout(200);

    const snap = await page.evaluate(safeSnapshot);

    // Should have at least 1 effect (the one updating count-display)
    assert.ok(snap.effectCount >= 1, `Expected >= 1 effect, got ${snap.effectCount}`);
  });

  test('signal updates are reflected', async () => {
    await page.goto(URL);
    await page.waitForSelector('#increment');
    await page.waitForTimeout(200);

    // Get initial count value via devtools
    const before = await page.evaluate(() => window.__TEST__.count());
    assert.strictEqual(before, 0);

    // Trigger update via click
    await page.click('#increment');
    await page.waitForTimeout(200);

    // Verify signal value updated
    const after = await page.evaluate(() => window.__TEST__.count());
    assert.strictEqual(after, 1, 'Signal value should increment to 1');

    // Registry should still have our signals
    const signalCount = await page.evaluate(() => window.__WHAT_DEVTOOLS__._registries.signals.size);
    assert.ok(signalCount >= 3, `Expected >= 3 signals in registry, got ${signalCount}`);
  });

  test('DevPanel toggle button renders', async () => {
    await page.goto(URL);
    await page.waitForSelector('#title');

    // The DevPanel renders a fixed "W" button
    const wButton = await page.locator('button:has-text("W")').first();
    await wButton.waitFor({ state: 'visible' });

    const text = await wButton.textContent();
    assert.strictEqual(text.trim(), 'W');
  });

  test('DevPanel opens and shows tabs', async () => {
    await page.goto(URL);
    await page.waitForSelector('#title');
    await page.waitForTimeout(200);

    // Click the W toggle button
    const wButton = await page.locator('button:has-text("W")').first();
    await wButton.click();
    await page.waitForTimeout(200);

    // Panel should be visible with tabs
    const signalsTab = await page.locator('button:has-text("Signals")').first();
    const effectsTab = await page.locator('button:has-text("Effects")').first();
    const componentsTab = await page.locator('button:has-text("Components")').first();

    assert.ok(await signalsTab.isVisible(), 'Signals tab should be visible');
    assert.ok(await effectsTab.isVisible(), 'Effects tab should be visible');
    assert.ok(await componentsTab.isVisible(), 'Components tab should be visible');
  });

  test('DevPanel signals tab shows tracked signals', async () => {
    await page.goto(URL);
    await page.waitForSelector('#title');
    await page.waitForTimeout(300);

    // Open the panel
    const wButton = await page.locator('button:has-text("W")').first();
    await wButton.click();
    await page.waitForTimeout(300);

    // Switch to the Signals tab (signal names only render there —
    // the default Overview tab shows counts, not names)
    const signalsTab = page.locator('button:has-text("Signals")').first();
    await signalsTab.click();
    await page.waitForTimeout(300);

    // Check signal names are visible in the panel
    const hasSignalText = await page.evaluate(() => {
      const body = document.body.textContent;
      return body.includes('signal_');
    });

    assert.ok(hasSignalText, 'Panel should show signal entries (signal_N names)');
  });

  test('DevPanel close button hides panel', async () => {
    await page.goto(URL);
    await page.waitForSelector('#title');
    await page.waitForTimeout(300);

    // Open panel
    const wButton = page.locator('button:has-text("W")').first();
    await wButton.click();
    await page.waitForTimeout(300);

    const signalsTab = page.locator('button:has-text("Signals")').first();
    assert.strictEqual(await signalsTab.isVisible(), true, 'Panel should be open');

    // Close via x button in panel header
    const closeButton = page.locator('button:has-text("x")').first();
    await closeButton.click();
    await page.waitForTimeout(300);

    assert.strictEqual(await signalsTab.isVisible(), false, 'Panel should be hidden after close');
  });

  test('subscribe receives events on signal change', async () => {
    await page.goto(URL);
    await page.waitForSelector('#title');
    await page.waitForTimeout(200);

    const events = await page.evaluate(() => {
      return new Promise(resolve => {
        const collected = [];
        const unsub = window.__TEST__.subscribe((event, data) => {
          collected.push({ event, id: data?.id });
        });

        // Trigger a signal change
        window.__TEST__.count(prev => prev + 1);

        // Give microtasks time to flush
        setTimeout(() => {
          unsub();
          resolve(collected);
        }, 100);
      });
    });

    // Should have received at least a signal:updated event
    const updateEvent = events.find(e => e.event === 'signal:updated');
    assert.ok(updateEvent, `Expected signal:updated event, got: ${JSON.stringify(events)}`);
  });
});
