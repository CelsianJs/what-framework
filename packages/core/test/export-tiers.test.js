// Every export of the packages whose source reads __DEV__ names its tiers by
// condition (docs/ARCHITECTURE.md, "Development and production tiers"):
// `production` the dist/*.min.js with development code removed, `module` the
// bundler tier (dist/*.js, checks read process.env.NODE_ENV), and the source
// for `development`, `node`, `import` and `default`. `development` and
// `production` come first, so Vite, webpack and Rollup never reach `module`;
// `node` comes before `module`, so a server bundle resolves the source as Node
// does. A bundler resolves the first key it accepts, so the order is the
// behaviour.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const ORDER = ['types', 'development', 'production', 'node', 'module', 'import', 'default'];
const PACKAGES = ['core', 'router', 'server'];
const DIST_BUILT = PACKAGES.every((name) => existsSync(join(repo, 'packages', name, 'dist', 'index.js')));

const manifest = (name) => JSON.parse(readFileSync(join(repo, 'packages', name, 'package.json'), 'utf8'));

// A `files` entry as a pattern over package-relative paths (`**/` any
// directories, `*` within one).
function globPattern(entry) {
  const source = entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*');
  return new RegExp(`^${source}(?:/.*)?$`);
}

// The tiers of one export, without a `node` branch that names its own files
// (what-server's root: the Node entry, which only Node-side code resolves).
function tiers(entry) {
  const branch = typeof entry.node === 'object' ? entry.node : null;
  const flat = Object.fromEntries(Object.entries(entry).filter(([key]) => !(branch && key === 'node')));
  return { branch, flat };
}

// The file esbuild resolves `specifier` to from the repo root.
async function resolveWith(specifier, options) {
  let resolved = null;
  await build({
    stdin: { contents: `import ${JSON.stringify(specifier)};`, resolveDir: repo },
    bundle: true,
    write: false,
    logLevel: 'silent',
    ...options,
    plugins: [{
      name: 'capture',
      setup(b) {
        b.onResolve({ filter: /^what-/ }, async (args) => {
          if (args.pluginData) return undefined;
          const r = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, pluginData: true });
          resolved = r.path;
          return { path: r.path, external: true };
        });
      },
    }],
  });
  return resolved;
}

for (const name of PACKAGES) {
  const pkg = manifest(name);
  describe(pkg.name, () => {
    it('lists every export in tier order, each tier at its file', () => {
      for (const [subpath, entry] of Object.entries(pkg.exports)) {
        const { branch, flat } = tiers(entry);
        const keys = Object.keys(flat);
        assert.deepEqual(keys, ORDER.filter((key) => key in flat && !(branch && key === 'node')), `${subpath}: condition order`);
        assert.deepEqual(keys.filter((key) => key !== 'types'), ORDER.filter((key) => key !== 'types' && !(branch && key === 'node')), `${subpath}: every tier named`);
        assert.equal(flat.development, flat.import, `${subpath}: development is the source`);
        if (!branch) assert.equal(flat.node, flat.import, `${subpath}: node is the source`);
        assert.equal(flat.default, flat.import, `${subpath}: default is the source`);
        assert.match(flat.production, /^\.\/dist\/.+\.min\.js$/, `${subpath}: production`);
        assert.equal(flat.module, flat.production.replace(/\.min\.js$/, '.js'), `${subpath}: module is the bundler tier beside it`);
        if (branch) assert.ok(!('module' in branch), `${subpath}: the node branch has no bundler tier`);
      }
    });

    it('publishes every file an export names', () => {
      const published = pkg.files.map(globPattern);
      for (const [subpath, entry] of Object.entries(pkg.exports)) {
        const { branch, flat } = tiers(entry);
        for (const target of [flat.production, flat.module, ...(branch ? [branch.production] : [])]) {
          assert.ok(published.some((pattern) => pattern.test(target.slice(2))), `${subpath}: ${target} is not in files`);
        }
      }
    });

    it('resolves each tier by condition', { skip: DIST_BUILT ? false : 'needs the built dist/ (npm run build)' }, async () => {
      for (const [subpath, entry] of Object.entries(pkg.exports)) {
        const specifier = pkg.name + subpath.slice(1);
        const { branch, flat } = tiers(entry);
        const file = (target) => join(repo, 'packages', name, target);
        assert.equal(await resolveWith(specifier, { platform: 'browser' }), file(flat.module), `${specifier}: esbuild's defaults`);
        assert.equal(await resolveWith(specifier, { platform: 'browser', conditions: ['production'] }), file(flat.production), `${specifier}: production`);
        assert.equal(await resolveWith(specifier, { platform: 'browser', conditions: ['development'] }), file(flat.development), `${specifier}: development`);
        assert.equal(await resolveWith(specifier, { platform: 'node' }), file(branch ? branch.import : flat.node), `${specifier}: a server bundle`);
        assert.equal(import.meta.resolve(specifier), `file://${file(branch ? branch.import : flat.import)}`, `${specifier}: Node`);
      }
    });
  });
}
