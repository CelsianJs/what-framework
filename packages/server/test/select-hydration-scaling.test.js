// Hydrating a controlled <select> is linear in its options. Each claimed
// option's attributes are rewritten one by one, and a select follows its
// options again after such a write; while the walk runs, it does so once,
// when the walk is done (dom.js refollow), and it writes only the options
// whose mark changes. Before, every claimed option re-marked every option of
// its select: 1,000 options took 134 ms to hydrate in Chromium, against 2 ms
// in 0.14.
//
// JSDOM counts the work: how often the select's option list is read and an
// option's selectedness written, which a per-option pass over all options
// multiplies by the option count. Chromium times it, against a generous bound.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { installDOM } from '../../../test-utils/dom.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

const browserAvailable = await chromiumLaunches(chromium);
const env = installDOM();
const { h, signal, hydrate } = await import('what-core');
const { renderToHydratableString } = await import('../src/index.js');

function Page({ options, picked }) {
  const value = signal(picked);
  return h('form', null, h('select', { name: 's', value, onChange: (e) => value(e.currentTarget.value) },
    ...Array.from({ length: options }, (_, i) => h('option', { value: 'o' + i }, 'Option ' + i))));
}

// The option-list reads and selectedness writes of one hydration of `options` options.
function work(options) {
  const host = document.createElement('div');
  document.body.append(host);
  host.innerHTML = renderToHydratableString(h(Page, { options, picked: 'o7' }));
  const counts = { reads: 0, writes: 0 };
  const list = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'options');
  const selected = Object.getOwnPropertyDescriptor(window.HTMLOptionElement.prototype, 'selected');
  Object.defineProperty(window.HTMLSelectElement.prototype, 'options', { ...list, get() { counts.reads++; return list.get.call(this); } });
  Object.defineProperty(window.HTMLOptionElement.prototype, 'selected', { ...selected, set(v) { counts.writes++; selected.set.call(this, v); } });
  let stop;
  try {
    stop = hydrate(h(Page, { options, picked: 'o7' }), host);
  } finally {
    Object.defineProperty(window.HTMLSelectElement.prototype, 'options', list);
    Object.defineProperty(window.HTMLOptionElement.prototype, 'selected', selected);
  }
  assert.equal(host.querySelector('select').value, 'o7');
  stop();
  host.remove();
  return counts;
}

describe('hydrating a controlled select', () => {
  it('reads its options a fixed number of times, whatever their count', () => {
    const small = work(250);
    const large = work(1000);
    assert.equal(large.reads, small.reads, `${small.reads} reads for 250 options, ${large.reads} for 1,000`);
    assert.ok(large.reads <= 6, `${large.reads} reads`);
    assert.ok(large.writes <= 4, `${large.writes} selectedness writes for 1,000 options`);
  });

  it('takes time linear in its options in Chromium', { skip: !browserAvailable }, async () => {
    const markup = (n) => renderToHydratableString(h(Page, { options: n, picked: 'o7' }));
    const entry = `
      import { h, hydrate, signal } from ${JSON.stringify(path.join(root, 'packages/core/src/index.js'))};
      ${Page.toString()}
      window.time = (n) => {
        const host = document.getElementById('app');
        const t = performance.now();
        const stop = hydrate(h(Page, { options: n, picked: 'o7' }), host);
        const ms = performance.now() - t;
        const value = host.querySelector('select').value;
        stop();
        return { ms, value };
      };`;
    const bundle = await build({ stdin: { contents: entry, resolveDir: here }, bundle: true, format: 'iife', write: false, minify: true,
      conditions: ['production'], define: { __WHAT_DEV__: 'false', 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
    const browser = await chromium.launch();
    try {
      const best = {};
      for (const n of [250, 1000]) {
        const html = markup(n);
        for (let i = 0; i < 5; i++) {
          const page = await browser.newPage();
          await page.setContent(`<!doctype html><div id="app">${html}</div>`);
          await page.addScriptTag({ content: bundle.outputFiles[0].text });
          const { ms, value } = await page.evaluate((count) => window.time(count), n);
          assert.equal(value, 'o7');
          best[n] = Math.min(best[n] ?? Infinity, ms);
          await page.close();
        }
      }
      // Linear is 4x; the quadratic walk was 12x.
      assert.ok(best[1000] < 8 * Math.max(best[250], 0.5), `250 options: ${best[250].toFixed(2)} ms, 1,000: ${best[1000].toFixed(2)} ms`);
    } finally {
      await browser.close();
    }
  });
});

process.on('exit', () => env.cleanup());
