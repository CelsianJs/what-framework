/**
 * Regression: the devtools bootstrap's imports must not go through Vite's
 * dependency optimizer.
 *
 * The bootstrap is a virtual module, so Vite's dependency scan never reads it
 * and found `what-devtools` and `what-devtools-mcp/client` only when a page
 * first asked for it. Vite then pre-bundled them after its first optimizer
 * run, changed its browser hash and told the page to reload. A page that was
 * still loading had no HMR socket yet to hear that, and loaded its remaining
 * imports under the new hash: two copies of what-core and of what-react in
 * one page, on which a React island threw "useCallback() called outside of a
 * component render" and the app rendered nothing. A scaffolded React app did
 * this on about half of its first dev-server starts (the scaffold smoke's
 * "dev: the page renders the app and the zustand demo").
 *
 * The plugin excludes both packages from the optimizer, as what-compiler's
 * plugin excludes the framework: they are served as ES modules, so nothing is
 * left to discover late.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import whatDevToolsMCP from '../src/vite-plugin.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const resolved = (inline = {}) => resolveConfig({
  root: HERE,
  configFile: false,
  logLevel: 'silent',
  ...inline,
  plugins: [whatDevToolsMCP(), ...(inline.plugins ?? [])],
}, 'serve');

describe('the devtools plugin keeps its bootstrap imports out of the dependency optimizer', () => {
  it('excludes what-devtools and what-devtools-mcp in the dev server config', async () => {
    const config = await resolved();
    assert.ok(config.optimizeDeps.exclude.includes('what-devtools'), 'what-devtools is excluded');
    assert.ok(config.optimizeDeps.exclude.includes('what-devtools-mcp'), 'what-devtools-mcp (and its /client entry) is excluded');
  });

  it("adds to the app's own exclusions and to another plugin's", async () => {
    const other = { name: 'other', config: () => ({ optimizeDeps: { exclude: ['from-a-plugin'] } }) };
    const config = await resolved({ optimizeDeps: { exclude: ['from-the-app'] }, plugins: [other] });
    for (const name of ['from-the-app', 'from-a-plugin', 'what-devtools', 'what-devtools-mcp']) {
      assert.ok(config.optimizeDeps.exclude.includes(name), `${name} is excluded`);
    }
  });

  it('changes nothing in a production build, where the plugin does not apply', async () => {
    const config = await resolveConfig({ root: HERE, configFile: false, logLevel: 'silent', plugins: [whatDevToolsMCP()] }, 'build');
    assert.ok(!(config.optimizeDeps.exclude ?? []).includes('what-devtools'));
  });
});
