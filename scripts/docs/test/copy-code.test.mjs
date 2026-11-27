// The docs site's copy buttons (docs-site/docs/copy-code.js): a copy shows
// "Copied!", and one the browser refuses (no clipboard permission, an insecure
// context or an iframe without one, no clipboard API at all) shows "Copy
// failed" and leaves no unhandled rejection or uncaught error on the page.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const source = readFileSync(new URL('../../../docs-site/docs/copy-code.js', import.meta.url), 'utf8');

// A docs page with one install block, the script run on it, and what it
// reported: errors on the page, rejections nothing handled, analytics events.
async function page(clipboard) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM('<pre><code>npm create what@latest</code></pre>', { runScripts: 'outside-only', virtualConsole });
  const { window } = dom;
  if (clipboard !== undefined) Object.defineProperty(window.navigator, 'clipboard', { value: clipboard, configurable: true });
  const timers = [];
  window.setTimeout = (fn) => timers.push(fn);
  window.clearTimeout = () => {};
  const tracked = [];
  window.lf = (...args) => tracked.push(args);
  window.eval(source);
  if (window.document.readyState === 'loading') await new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve));
  return { window, button: window.document.querySelector('.copy-btn'), errors, timers, tracked };
}

async function click(p) {
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  try {
    p.button.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  return rejections;
}

describe('docs copy buttons', () => {
  it('a copy shows "Copied!", tracks the kind of block and goes back to "Copy"', async () => {
    const written = [];
    const p = await page({ writeText: async (text) => { written.push(text); } });
    assert.deepEqual(await click(p), []);
    assert.deepEqual(written, ['npm create what@latest']);
    assert.equal(p.button.textContent, 'Copied!');
    assert.ok(p.button.classList.contains('copied'));
    assert.deepEqual(JSON.parse(JSON.stringify(p.tracked)), [['track', 'install.copy', { source: 'docs' }]]);
    for (const fn of p.timers) fn();
    assert.equal(p.button.textContent, 'Copy');
    assert.equal(p.button.className, 'copy-btn');
  });

  it('a write the browser refuses shows "Copy failed" and leaves no unhandled rejection', async () => {
    const p = await page({ writeText: () => Promise.reject(new Error("Failed to execute 'writeText' on 'Clipboard': Write permission denied.")) });
    assert.deepEqual(await click(p), []);
    assert.equal(p.button.textContent, 'Copy failed');
    assert.ok(p.button.classList.contains('failed'));
    assert.deepEqual(p.tracked, [], 'a failed copy is not tracked as a copy');
    for (const fn of p.timers) fn();
    assert.equal(p.button.textContent, 'Copy');
    assert.equal(p.button.className, 'copy-btn');
  });

  it('a page without the clipboard API shows "Copy failed" and throws nothing', async () => {
    const p = await page(undefined);
    assert.equal(p.window.navigator.clipboard, undefined);
    assert.deepEqual(await click(p), []);
    assert.deepEqual(p.errors, []);
    assert.equal(p.button.textContent, 'Copy failed');
  });
});
