/**
 * vite-plugin-what config shaping — Vite 8 `oxc` vs Vite ≤7 `esbuild`.
 *
 * Vite 8 (rolldown-based) deprecates the `esbuild` transform option:
 *   "'esbuild' option ... is deprecated, please use 'oxc' instead"
 * The plugin must emit `oxc: { jsx: 'preserve' }` on Vite ≥8 (or whenever the
 * plugin context reports a rolldownVersion) and keep `esbuild: { jsx:
 * 'preserve' }` on Vite ≤7. These tests pin the pure helper for both branches
 * and the full config() hook output under both plugin contexts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import whatVitePlugin, { jsxPreserveConfig } from '../src/vite-plugin.js';

describe('jsxPreserveConfig (pure helper)', () => {
  it('defaults to esbuild when nothing is detectable', () => {
    assert.deepEqual(jsxPreserveConfig({}), { esbuild: { jsx: 'preserve' } });
    assert.deepEqual(jsxPreserveConfig(), { esbuild: { jsx: 'preserve' } });
  });

  it('uses esbuild on Vite 7', () => {
    assert.deepEqual(
      jsxPreserveConfig({ viteVersion: '7.3.5' }),
      { esbuild: { jsx: 'preserve' } }
    );
  });

  it('uses esbuild on Vite 6 and 5', () => {
    assert.deepEqual(jsxPreserveConfig({ viteVersion: '6.0.0' }), { esbuild: { jsx: 'preserve' } });
    assert.deepEqual(jsxPreserveConfig({ viteVersion: '5.4.11' }), { esbuild: { jsx: 'preserve' } });
  });

  it('uses oxc on Vite 8', () => {
    assert.deepEqual(
      jsxPreserveConfig({ viteVersion: '8.0.0' }),
      { oxc: { jsx: 'preserve' } }
    );
    assert.deepEqual(
      jsxPreserveConfig({ viteVersion: '8.2.1-beta.0' }),
      { oxc: { jsx: 'preserve' } }
    );
  });

  it('uses oxc on future majors (Vite 9+)', () => {
    assert.deepEqual(jsxPreserveConfig({ viteVersion: '9.0.0' }), { oxc: { jsx: 'preserve' } });
  });

  it('feature-detect: rolldownVersion wins even when vite reports ≤7 (aliased rolldown-vite)', () => {
    assert.deepEqual(
      jsxPreserveConfig({ rolldownVersion: '1.0.0', viteVersion: '7.1.0' }),
      { oxc: { jsx: 'preserve' } }
    );
  });

  it('garbage version falls back to esbuild (safe default)', () => {
    assert.deepEqual(jsxPreserveConfig({ viteVersion: 'not-a-version' }), { esbuild: { jsx: 'preserve' } });
    assert.deepEqual(jsxPreserveConfig({ viteVersion: '' }), { esbuild: { jsx: 'preserve' } });
    assert.deepEqual(jsxPreserveConfig({ viteVersion: null }), { esbuild: { jsx: 'preserve' } });
  });
});

describe('config() hook output', () => {
  const env = { mode: 'development', command: 'serve' };

  it('emits oxc (and NO esbuild key) when the plugin context reports rolldown', async () => {
    const plugin = whatVitePlugin();
    const cfg = await plugin.config.call({ meta: { rolldownVersion: '1.0.0' } }, {}, env);
    assert.deepEqual(cfg.oxc, { jsx: 'preserve' });
    assert.equal(cfg.esbuild, undefined, 'esbuild key must be absent on rolldown — it is what triggers the deprecation');
    // The rest of the config must survive the shape change
    assert.ok(Array.isArray(cfg.optimizeDeps.exclude));
    assert.ok(cfg.optimizeDeps.exclude.includes('what-framework'));
  });

  it('emits esbuild (and NO oxc key) under classic Vite (installed vite is ≤7)', async () => {
    const installedMajor = parseInt((await import('vite')).version, 10);
    if (installedMajor >= 8) {
      // Repo upgraded to Vite 8 — the classic branch is covered by the pure
      // helper tests above; here the hook must emit oxc instead.
      const plugin = whatVitePlugin();
      const cfg = await plugin.config.call({ meta: {} }, {}, env);
      assert.deepEqual(cfg.oxc, { jsx: 'preserve' });
      assert.equal(cfg.esbuild, undefined);
      return;
    }
    const plugin = whatVitePlugin();
    const cfg = await plugin.config.call({ meta: {} }, {}, env);
    assert.deepEqual(cfg.esbuild, { jsx: 'preserve' });
    assert.equal(cfg.oxc, undefined, 'oxc key must be absent on Vite ≤7 — unknown root options warn');
    assert.ok(cfg.optimizeDeps.exclude.includes('what-core'));
  });

  it('still adds the production resolve condition on prod builds', async () => {
    const plugin = whatVitePlugin();
    const cfg = await plugin.config.call({ meta: {} }, {}, { mode: 'production', command: 'build' });
    assert.deepEqual(cfg.resolve, { conditions: ['production'] });
  });
});
