// Publish-surface safety net (D4, sprint/v0.11-quality).
//
// 1. Every documented what-framework subpath ('.', './router', './server',
//    './jsx-runtime', plus the rest of the exports map) must resolve AND
//    re-export the names the docs promise. The umbrella package is pure
//    re-exports, so a broken inner package or a typo'd specifier shows up
//    here before it ships.
// 2. The "production" condition must resolve to dist/*.min.js when built
//    (verified in a spawned `node --conditions=production` child, exactly
//    how a bundler-less production server resolves it).
// 3. Structural validation of ALL packages/* exports maps: parse each
//    package.json and assert every referenced file actually exists, so a
//    renamed/deleted file can never be published as a dangling subpath.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = resolve(pkgDir, '..');
const repoRoot = resolve(packagesDir, '..');

const whatPkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

// =========================================================================
// 1. Documented subpaths resolve + re-export the expected names
// =========================================================================

// The names the README/docs (and vura) rely on per subpath. Not exhaustive —
// these are the load-bearing public APIs that must never silently vanish.
const EXPECTED_EXPORTS = {
  '.': [
    'signal', 'effect', 'computed', 'batch', 'untrack',
    'h', 'mount', 'hydrate', 'onMount', 'onCleanup',
    'For', 'Show', 'Suspense', 'ErrorBoundary', 'Fragment',
    'createStore', 'createResource', 'createContext', 'useContext', 'lazy',
  ],
  './router': [
    'Router', 'Link', 'NavLink', 'Outlet', 'route', 'navigate',
    'matchRoute', 'parseQuery', 'useRoute', 'defineRoutes',
  ],
  './server': [
    'renderToString', 'renderToStringAsync', 'renderDocument', 'renderToStream',
    'createRequestHandler', 'createActionHandler', 'createServer',
    'action', 'formAction', 'island', 'Island', 'hydrateIslands',
    'generateCsrfToken', 'validateCsrfToken', 'csrfMetaTag',
    'exportStatic', 'createVercelHandler', 'createCloudflareHandler',
  ],
  './jsx-runtime': ['jsx', 'jsxs', 'Fragment'],
  './jsx-dev-runtime': [],
  './render': [],
  './testing': [],
};

describe('what-framework documented subpaths', () => {
  it('exports map covers exactly the documented subpaths', () => {
    assert.deepEqual(
      Object.keys(whatPkg.exports).sort(),
      Object.keys(EXPECTED_EXPORTS).sort(),
      'exports map drifted from the documented subpath list — update EXPECTED_EXPORTS and the docs together'
    );
  });

  for (const [subpath, names] of Object.entries(EXPECTED_EXPORTS)) {
    const specifier = subpath === '.' ? 'what-framework' : `what-framework/${subpath.slice(2)}`;
    it(`${specifier} resolves and re-exports expected names`, async () => {
      const mod = await import(specifier);
      const keys = new Set(Object.keys(mod));
      const missing = names.filter((n) => !keys.has(n));
      assert.deepEqual(missing, [], `${specifier} is missing exports: ${missing.join(', ')}`);
    });
  }
});

// =========================================================================
// 2. Production condition resolves to dist (when built)
// =========================================================================

describe('what-framework production condition', () => {
  const distBuilt = existsSync(join(pkgDir, 'dist', 'index.min.js'));

  for (const [subpath, targets] of Object.entries(whatPkg.exports)) {
    const prodTarget = targets.production;
    if (!prodTarget) continue;
    const specifier = subpath === '.' ? 'what-framework' : `what-framework/${subpath.slice(2)}`;

    it(`${specifier} resolves to ${prodTarget} under --conditions=production`, (t) => {
      if (!distBuilt) {
        t.skip('dist/ not built (run `npm run build`); production resolution checked post-build by test:prod');
        return;
      }
      const child = spawnSync(process.execPath, [
        '--conditions=production',
        '--input-type=module',
        '-e',
        `process.stdout.write(import.meta.resolve(${JSON.stringify(specifier)}))`,
      ], { cwd: repoRoot, encoding: 'utf8' });
      assert.equal(child.status, 0, `resolution failed: ${child.stderr}`);
      const resolved = fileURLToPath(child.stdout.trim());
      assert.equal(
        resolved,
        resolve(pkgDir, prodTarget),
        `production condition must resolve to the dist build, got: ${resolved}`
      );
      assert.match(resolved, /[/\\]dist[/\\].+\.min\.js$/, 'production target must be a minified dist file');
    });
  }
});

// =========================================================================
// 3. Structural validation of every package's exports map
// =========================================================================

function exportLeaves(node, leaves = []) {
  if (typeof node === 'string') leaves.push(node);
  else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) exportLeaves(v, leaves);
  }
  return leaves;
}

describe('packages/* exports maps reference real files (publish-surface safety net)', () => {
  const pkgNames = readdirSync(packagesDir).filter((name) => {
    try { return statSync(join(packagesDir, name, 'package.json')).isFile(); } catch { return false; }
  }).sort();

  it('discovers every package in the monorepo', () => {
    assert.ok(pkgNames.length >= 14, `expected >= 14 packages, found ${pkgNames.length}: ${pkgNames.join(', ')}`);
  });

  for (const name of pkgNames) {
    const dir = join(packagesDir, name);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const distBuilt = existsSync(join(dir, 'dist'));

    it(`${manifest.name || name}: all referenced entry files exist`, () => {
      const refs = [];

      // exports map (string leaves of arbitrarily nested condition objects)
      if (manifest.exports) refs.push(...exportLeaves(manifest.exports));
      // classic entry fields
      for (const field of ['main', 'module', 'types']) {
        if (typeof manifest[field] === 'string') refs.push(manifest[field]);
      }
      // bin entries
      if (typeof manifest.bin === 'string') refs.push(manifest.bin);
      else if (manifest.bin && typeof manifest.bin === 'object') refs.push(...Object.values(manifest.bin));

      const missing = [];
      for (const ref of refs) {
        if (!ref.startsWith('.')) continue; // external specifier, not a file
        // dist/ artifacts are gitignored; only enforce them once the package
        // has been built (test:prod + release:verify enforce post-build).
        if (/^\.\/?dist[/\\]/.test(ref) && !distBuilt) continue;
        if (!existsSync(join(dir, ref))) missing.push(ref);
      }
      assert.deepEqual(missing, [], `${name}/package.json references missing files: ${missing.join(', ')}`);
    });

    it(`${manifest.name || name}: exports map shape is sane`, () => {
      if (!manifest.exports) return; // bin-only packages (create-what, mcp-server)
      assert.equal(typeof manifest.exports, 'object', 'exports must be an object map');
      for (const [key, value] of Object.entries(manifest.exports)) {
        assert.ok(key === '.' || key.startsWith('./'), `subpath key must be "." or "./*": ${key}`);
        const leaves = exportLeaves(value);
        assert.ok(leaves.length > 0, `subpath ${key} has no targets`);
        for (const leaf of leaves) {
          assert.ok(leaf.startsWith('./'), `export target must be a relative "./" path: ${key} -> ${leaf}`);
        }
      }
    });
  }
});
