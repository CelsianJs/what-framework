// Buildless pages load the framework as native ES modules through an import
// map, and a browser refuses the whole module graph when one bare specifier in
// it is missing from the map: hydration never starts, and the page stays
// server HTML with dead buttons. Node and Vite resolve through package exports
// and never consult the map, so neither the unit tests nor smoke:workspace-apps
// notice a missing entry; only smoke:apps does, in a browser, as a timeout.
//
// This walks each buildless smoke app's client graph the way a browser does
// (static and dynamic imports, through the packages) and checks that the app's
// own import map resolves every bare specifier to the file the package exports.
// It also pins what what-server/islands, the browser half of this package,
// asks an import map for, since every buildless app that loads it has to map
// each of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const repo = resolve(import.meta.dirname, '../../..');
const appsDir = join(repo, 'smoke/apps');
const SKIP = { skip: true };

/**
 * Every bare specifier reachable from `entry` in a browser: [{ spec, importer, file }].
 * Resolved as an import map resolves exports (create-what's BROWSER_CONDITIONS:
 * `browser`, `import`, `default`), not with esbuild's own defaults, whose
 * `module` condition is the bundler tier.
 */
async function browserImports(entry) {
  const found = [];
  await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'browser',
    conditions: ['browser'],
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'record-bare-imports',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, async (args) => {
          if (args.pluginData === SKIP) return undefined;
          const r = await b.resolve(args.path, {
            kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: SKIP,
          });
          if (r.errors.length) return { errors: r.errors };
          found.push({ spec: args.path, importer: args.importer, file: r.path });
          return { path: r.path };
        });
      },
    }],
  });
  return found;
}

// The app's `const importMap = { ... };` as development builds it (isProd
// false maps the devtools entries too).
function appImportMap(serverFile) {
  const src = readFileSync(serverFile, 'utf8');
  const m = /^const importMap = (\{[\s\S]*?\n\});$/m.exec(src);
  assert.ok(m, `${relative(repo, serverFile)} declares \`const importMap = { ... };\``);
  const { imports, scopes = {} } = runInNewContext(`(${m[1]})`, { isProd: false, Object });
  return { imports, scopes };
}

// The URL a map entry points at, as a file: /node_modules/<name>/<path> is
// served from the app's node_modules, which in this workspace is the package.
function mappedFile(url, name) {
  const prefix = `/node_modules/${name}/`;
  if (!url.startsWith(prefix)) return null;
  const file = join(repo, 'node_modules', name, url.slice(prefix.length));
  return existsSync(file) ? realpathSync(file) : null;
}

function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// A package's own `#` import resolves only inside the package: through the
// scope of the URL the importer is served from, /node_modules/<name>/.
// [package name, url] or null.
function scoped(scopes, spec, importer) {
  for (const [prefix, entries] of Object.entries(scopes)) {
    const name = /^\/node_modules\/((?:@[^/]+\/)?[^/]+)\/$/.exec(prefix)?.[1];
    if (!name || !Object.hasOwn(entries, spec)) continue;
    const dir = realpathSync(join(repo, 'node_modules', name));
    if (realpathSync(importer).startsWith(dir + '/')) return [name, entries[spec]];
  }
  return null;
}

const apps = readdirSync(appsDir)
  .filter((name) => existsSync(join(appsDir, name, 'server.js')))
  .filter((name) => /^const importMap = /m.test(readFileSync(join(appsDir, name, 'server.js'), 'utf8')));

test('every buildless smoke app is checked', () => {
  assert.deepEqual(apps.sort(), ['ops-console', 'scrollytelling', 'storefront']);
});

for (const app of apps) {
  test(`${app}: the import map resolves every bare import its client entry reaches`, async () => {
    const dir = join(appsDir, app);
    const server = readFileSync(join(dir, 'server.js'), 'utf8');
    const entries = [...new Set([...server.matchAll(/clientEntry:\s*'([^']+)'/g)].map((m) => m[1]))];
    assert.ok(entries.length > 0, `${app} names a client entry`);
    const { imports: map, scopes } = appImportMap(join(dir, 'server.js'));

    const problems = [];
    for (const [spec, url] of Object.entries(map)) {
      if (!mappedFile(url, packageName(spec))) problems.push(`${spec} maps to ${url}, which is not a file in ${packageName(spec)}`);
    }
    for (const entry of entries) {
      for (const { spec, importer, file } of await browserImports(join(dir, entry))) {
        const from = relative(repo, importer);
        const [name, url] = spec.startsWith('#') ? scoped(scopes, spec, importer) ?? [] : [packageName(spec), map[spec]];
        if (url === undefined) {
          problems.push(`${spec} (imported by ${from}) is not in the import map`);
          continue;
        }
        const served = mappedFile(url, name);
        if (served !== realpathSync(file)) {
          problems.push(`${spec} maps to ${url}, but the package exports ${relative(repo, realpathSync(file))}`);
        }
      }
    }
    assert.deepEqual([...new Set(problems)], []);
  });
}

test('what-server/islands asks an import map for what-core, what-core/internal and what-core\'s #env only', async () => {
  const reached = await browserImports(join(repo, 'packages/server/src/islands.js'));
  assert.deepEqual([...new Set(reached.map((r) => r.spec))].sort(), ['#env', 'what-core', 'what-core/internal']);
});
