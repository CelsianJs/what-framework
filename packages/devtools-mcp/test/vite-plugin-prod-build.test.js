/**
 * Regression: the devtools/MCP client must NEVER ship in a production build.
 *
 * A real deploy once shipped the dev-only bootstrap into prod: the production
 * page requested `virtual:what-devtools-mcp/bootstrap` (500 in prod) and, with a
 * dev server live on the machine, could follow it to localhost. These tests run
 * a real `vite build` with the plugin and assert the emitted bundle contains
 * ZERO devtools references — and that the same plugin STILL injects the
 * bootstrap during a dev (serve) transform, so the guard is dev-only, not a
 * blanket disable.
 *
 * Two prod scenarios are covered:
 *   1. The plugin used normally (its `apply: 'serve'` excludes it from build).
 *   2. The plugin's `apply` stripped — simulating a meta-framework/consumer that
 *      re-invokes hooks at build time. The plugin's own `command === 'build'`
 *      guard must still keep every devtools reference out of the bundle.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_SRC = join(HERE, '..', 'src');

// Anything that would betray the devtools/MCP client leaking into the bundle.
const FORBIDDEN = [
  'what-devtools-mcp',
  'virtual:what-devtools',
  '__x00__',
  'connectDevToolsMCP',
  '__what_mcp',
];

function allBundleText(distDir) {
  let text = '';
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else text += '\n' + readFileSync(p, 'utf8');
    }
  };
  walk(distDir);
  return text;
}

function scaffold(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><html><head><title>t</title></head>' +
      '<body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>',
  );
  writeFileSync(join(dir, 'src', 'main.js'), "document.getElementById('app').textContent = 'ok';\n");
}

// Aliases so the bootstrap's bare imports resolve if it ever DID get pulled in
// (a leak would then surface as real devtools code in the bundle, not a build
// error that masks the check).
const ALIASES = {
  'what-core': join(HERE, '..', '..', 'core', 'src', 'index.js'),
  'what-devtools': join(HERE, '..', '..', 'devtools', 'src', 'index.js'),
  'what-devtools-mcp/client': join(PKG_SRC, 'client.js'),
};

async function buildWith(plugin, dir) {
  const { build } = await import('vite');
  await build({
    root: dir,
    logLevel: 'silent',
    resolve: { alias: ALIASES },
    plugins: [plugin],
    build: { outDir: 'dist', emptyOutDir: true },
  });
  return allBundleText(join(dir, 'dist'));
}

describe('vite-plugin production build contains zero devtools code', () => {
  let whatDevToolsMCP;
  let tmp;

  before(async () => {
    ({ default: whatDevToolsMCP } = await import('../src/vite-plugin.js'));
    // Keep the scratch project INSIDE the repo. In the OS tmpdir, macOS's
    // /var -> /private/var symlink makes Vite treat the root as "outside" cwd
    // and rollup rejects the escaping index.html asset name.
    tmp = mkdtempSync(join(HERE, '.tmp-build-'));
  });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it('a normal prod build (apply: "serve" excludes the plugin) has no devtools refs', async () => {
    const dir = join(tmp, 'normal');
    scaffold(dir);
    const bundle = await buildWith(whatDevToolsMCP(), dir);
    for (const needle of FORBIDDEN) {
      assert.ok(!bundle.includes(needle), `prod bundle must not contain "${needle}"`);
    }
  });

  it('a prod build with apply stripped STILL has no devtools refs (command guard)', async () => {
    const dir = join(tmp, 'apply-stripped');
    scaffold(dir);
    // Simulate a consumer/meta-framework that defeats `apply: 'serve'` and lets
    // the plugin's hooks run at build time. The command-based guard must hold.
    const plugin = whatDevToolsMCP();
    delete plugin.apply;
    const bundle = await buildWith(plugin, dir);
    for (const needle of FORBIDDEN) {
      assert.ok(!bundle.includes(needle), `prod bundle (apply stripped) must not contain "${needle}"`);
    }
  });
});

describe('vite-plugin dev (serve) transform still injects the bootstrap', () => {
  it('injects the devtools bootstrap <script> when command is serve', async () => {
    const { default: whatDevToolsMCP } = await import('../src/vite-plugin.js');
    const plugin = whatDevToolsMCP();
    // Emulate Vite resolving the config for a dev server.
    plugin.configResolved({ command: 'serve' });

    const html = plugin.transformIndexHtml();
    assert.ok(Array.isArray(html) && html.length === 1, 'injects exactly one tag in serve mode');
    assert.equal(html[0].tag, 'script');
    assert.match(html[0].attrs.src, /virtual:what-devtools-mcp\/bootstrap/);

    // And it resolves + loads the virtual module in serve mode.
    const resolved = plugin.resolveId('virtual:what-devtools-mcp/bootstrap');
    assert.equal(resolved, '\0virtual:what-devtools-mcp/bootstrap');
    const code = plugin.load(resolved);
    assert.match(code, /connectDevToolsMCP\(/);
    assert.match(code, /import\.meta\.env && import\.meta\.env\.DEV/);
  });

  it('injects NOTHING once the command resolves to build', async () => {
    const { default: whatDevToolsMCP } = await import('../src/vite-plugin.js');
    const plugin = whatDevToolsMCP();
    plugin.configResolved({ command: 'build' });

    assert.equal(plugin.transformIndexHtml(), undefined, 'no HTML injection in build');
    assert.equal(plugin.resolveId('virtual:what-devtools-mcp/bootstrap'), null, 'does not own the id in build');
    assert.equal(plugin.load('\0virtual:what-devtools-mcp/bootstrap'), null, 'emits no source in build');
  });
});
