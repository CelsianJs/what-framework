/**
 * The page side of what_eval (no browser): fixed safe reads resolved with the
 * accessors captured at load, and arbitrary code refused unless the page opted
 * in. Critical 5 of the review: a safe read used to run as a statement through
 * the Function constructor and returned undefined.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

let saved;
let resolveSafeRead;
let normalizeSafeRead;
let handleExtendedCommand;
let doc;

before(async () => {
  saved = globalThis.window;
  // A window shaped like the platform's: `document` and `location` are
  // accessors on window, `title` an accessor on the document's prototype.
  class FakeDocument { get title() { return 'Real title'; } }
  doc = new FakeDocument();
  const location = {};
  Object.defineProperty(location, 'href', { get: () => 'http://localhost:5173/x', enumerable: true });
  const win = {};
  Object.defineProperty(win, 'document', { get: () => doc });
  Object.defineProperty(win, 'location', { get: () => location });
  Object.defineProperty(win, 'innerWidth', { get: () => 1280, configurable: true });
  globalThis.window = win;
  ({ resolveSafeRead, normalizeSafeRead } = await import('../src/safe-read.js'));
  ({ handleExtendedCommand } = await import('../src/client-commands.js'));
});

after(() => {
  globalThis.window = saved;
});

describe('safe reads', () => {
  it('accept exactly the listed paths, with or without window.', () => {
    assert.equal(normalizeSafeRead('document.title'), 'document.title');
    assert.equal(normalizeSafeRead(' window.document.title '), 'document.title');
    for (const code of ['document.cookie', 'window.localStorage', 'document', 'document.title.length', 'document.title;alert(1)', 'window["document"].title']) {
      assert.equal(normalizeSafeRead(code), null, code);
    }
  });

  it('return the value', () => {
    assert.deepEqual(resolveSafeRead('document.title'), { path: 'document.title', value: 'Real title' });
    assert.equal(resolveSafeRead('location.href').value, 'http://localhost:5173/x');
    assert.equal(resolveSafeRead('innerWidth').value, 1280);
  });

  it('never call a getter or read a value the page defined after load', () => {
    let ran = false;
    Object.defineProperty(doc, 'title', { configurable: true, get() { ran = true; return 'spoofed'; } });
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 1, configurable: true });
    assert.equal(resolveSafeRead('document.title').value, 'Real title');
    assert.equal(resolveSafeRead('innerWidth').value, 1280);
    assert.equal(ran, false);
  });

  it('refuse anything else', () => {
    assert.match(resolveSafeRead('document.cookie').error, /Not a safe read/);
  });
});

describe('page-side eval', () => {
  it('refuses arbitrary code unless the page opted in', async () => {
    const out = await handleExtendedCommand('eval', { code: 'document.title' }, null);
    assert.match(out.error, /has not enabled eval/);
  });

  it('returns the value of an expression once enabled', async () => {
    globalThis.window.__WHAT_UNSAFE_EVAL__ = true;
    try {
      const out = await handleExtendedCommand('eval', { code: '1 + 2' }, null);
      assert.deepEqual([out.result, out.type], ['3', 'number']);
      const statements = await handleExtendedCommand('eval', { code: 'const a = 2; return a * 3;' }, null);
      assert.equal(statements.result, '6');
    } finally {
      delete globalThis.window.__WHAT_UNSAFE_EVAL__;
    }
  });
});
