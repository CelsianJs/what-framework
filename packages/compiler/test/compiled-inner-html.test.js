// A compiled element's reactive innerHTML: examples/npm-app-suite/app-06-html
// renders it in a conditional branch and on an <svg>, and updates it. The page
// showed nothing because the example passed innerHTML a plain string, which
// What refuses on every path (only { __html } is parsed as markup, and
// development warns about a string). The example is compiled from its own
// source here, so it cannot drift back.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><head></head><body><div id="app"></div></body></html>');
const { flushSync } = await import('../../core/src/reactive.js');

const EXAMPLE = fileURLToPath(new URL('../../../examples/npm-app-suite/app-06-html/src/main.jsx', import.meta.url));

describe('compiled innerHTML bindings (app-06-html)', () => {
  it('the example renders its markup, then updates it, in the branch and on the <svg>', async () => {
    const source = readFileSync(EXAMPLE, 'utf8').replace("mount(<App />, '#app');", "mount(<App />, '#app');\nexport { App };");
    await loadCompiled(source);
    flushSync();
    const app = document.getElementById('app');
    const panel = () => app.querySelector('.panel');
    assert.match(panel().textContent, /Rendered count:\s*1/);
    assert.equal(app.querySelector('svg circle').getAttribute('fill'), '#2563eb');

    app.querySelector('button').click();
    flushSync();
    assert.match(panel().textContent, /Rendered count:\s*2/);
    assert.equal(app.querySelector('svg circle').getAttribute('fill'), '#16a34a');

    // The other branch, dangerouslySetInnerHTML.
    [...app.querySelectorAll('button')].find((b) => b.textContent.includes('Toggle')).click();
    flushSync();
    assert.match(panel().textContent, /Rendered count:\s*2/);
  });

  it('a plain string is refused, with a warning, on the compiled path as on every other', async () => {
    const warnings = [];
    const warn = console.warn;
    console.warn = (message) => warnings.push(String(message));
    try {
      const mod = await loadCompiled('export const a = (html) => <section innerHTML={html()} />;');
      const host = document.createElement('div');
      host.append(mod.a(() => '<b>raw</b>'));
      flushSync();
      assert.equal(host.firstChild.innerHTML, '');
    } finally {
      console.warn = warn;
    }
    assert.ok(warnings.some((w) => /ERR_UNSAFE_INNERHTML/.test(w)), warnings.join('\n'));
  });
});
