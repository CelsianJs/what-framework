#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { packages as buildPackages, tierEntries } from './build.js';

const repoRoot = resolve(import.meta.dirname, '..');

const allowedPublicPackageJson = new Set([
  'packages/cache/package.json',
  'packages/cli/package.json',
  'packages/compiler/package.json',
  'packages/core/package.json',
  'packages/create-what/package.json',
  'packages/devtools-mcp/package.json',
  'packages/devtools/package.json',
  'packages/eslint-plugin/package.json',
  'packages/mcp-server/package.json',
  'packages/react-compat/package.json',
  'packages/router/package.json',
  'packages/server/package.json',
  'packages/what-text/package.json',
  'packages/what/package.json',
]);

const trackedPackageJson = execFileSync('git', ['ls-files', '*package.json'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter((path) => !path.includes('/node_modules/'));

const unexpectedPublic = [];
const missingAllowed = [];

// Every published package declares the Node range the repository supports,
// so npm warns a user on an older Node at install time (check:node-floor
// holds the code to it).
const nodeRange = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).engines?.node;

for (const path of trackedPackageJson) {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'));
  if (allowedPublicPackageJson.has(path)) {
    if (pkg.private === true) {
      missingAllowed.push(`${path} is listed as public but has private=true`);
    }
    if (pkg.engines?.node !== nodeRange) {
      missingAllowed.push(`${path} declares engines.node ${JSON.stringify(pkg.engines?.node ?? null)}, not the repository's ${JSON.stringify(nodeRange)}`);
    }
    continue;
  }
  if (pkg.private !== true) {
    unexpectedPublic.push(`${path} (${pkg.name || '<unnamed>'})`);
  }
}

for (const path of allowedPublicPackageJson) {
  if (!trackedPackageJson.includes(path)) {
    missingAllowed.push(`${path} is listed as public but is not tracked`);
  }
}

if (unexpectedPublic.length || missingAllowed.length) {
  console.error('[publish-surface] Invalid package publish surface.');
  if (unexpectedPublic.length) {
    console.error('\nUnexpected non-private package manifests:');
    for (const item of unexpectedPublic) console.error(`  - ${item}`);
  }
  if (missingAllowed.length) {
    console.error('\nInvalid intended public package manifests:');
    for (const item of missingAllowed) console.error(`  - ${item}`);
  }
  console.error(
    `\nOnly ${relative(repoRoot, repoRoot) || '.'}/packages/* release packages in the allowlist may be non-private.`,
  );
  process.exit(1);
}

console.log(
  `[publish-surface] OK: ${allowedPublicPackageJson.size} intended public packages; all other tracked package manifests are private.`,
);

// ---------------------------------------------------------------------------
// Exports-map resolvability
//
// Every public package subpath must resolve under BOTH the ESM (`import`) and
// CJS (`require`/`default`) resolution algorithms. A conditional exports entry
// that lists only `import` (and `types`) has NO `require`/`default` fallback, so
// `createRequire(...).resolve('<pkg>')` throws ERR_PACKAGE_PATH_NOT_EXPORTED —
// which breaks real consumers whose vite.config / vitest resolve our packages
// through the CJS resolver. This regressed in 0.11.3 (what-react's string export
// was rewritten to an object without `default`). Guard it here so an exports map
// can never silently lose its CJS entry point again.
//
// Workspace packages are symlinked into node_modules under their published name,
// so the resolver sees the real package.json exports map.
// ---------------------------------------------------------------------------

const requireFromRoot = createRequire(join(repoRoot, 'noop.js'));
const exportsFailures = [];
let exportsCheckedSubpaths = 0;

for (const path of allowedPublicPackageJson) {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8'));
  const exportsMap = pkg.exports;
  if (!exportsMap) continue; // no exports field: legacy `main` resolution, nothing to check
  const subpaths = typeof exportsMap === 'string' ? ['.'] : Object.keys(exportsMap);
  for (const subpath of subpaths) {
    // '.' -> 'what-react'; './vite' -> 'what-react/vite'
    const spec = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
    exportsCheckedSubpaths += 1;
    try {
      requireFromRoot.resolve(spec);
    } catch (err) {
      exportsFailures.push(
        `${spec} (${path}) -> ${err.code || err.message}` +
          (err.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
            ? ' — add a `default` condition (last) pointing at the ESM entry'
            : ''),
      );
    }
  }
}

if (exportsFailures.length) {
  console.error('\n[publish-surface] Unresolvable package exports (CJS resolver / createRequire().resolve()):');
  for (const item of exportsFailures) console.error(`  - ${item}`);
  console.error('\nEvery public exports subpath must resolve under require() as well as import().');
  process.exit(1);
}

console.log(
  `[publish-surface] OK: ${exportsCheckedSubpaths} public exports subpaths resolve under the CJS resolver (require/default).`,
);

// ---------------------------------------------------------------------------
// what-framework mirrors what-core
//
// Apps depend on what-framework alone, so every what-core subpath an app may
// import (the root, the compiled-JSX runtime, the domain kits) must exist under
// the same name in what-framework. what-core/internal is what-core's interface
// to its sibling packages and is deliberately not mirrored, with its subpaths.
// ---------------------------------------------------------------------------

{
  const coreExports = JSON.parse(readFileSync(join(repoRoot, 'packages/core/package.json'), 'utf8')).exports;
  const whatExports = JSON.parse(readFileSync(join(repoRoot, 'packages/what/package.json'), 'utf8')).exports;
  const isInternal = (subpath) => subpath === './internal' || subpath.startsWith('./internal/');
  const unmirrored = Object.keys(coreExports).filter((subpath) => !isInternal(subpath) && !(subpath in whatExports));
  if (unmirrored.length) {
    console.error('\n[publish-surface] what-core subpaths missing from what-framework:');
    for (const subpath of unmirrored) console.error(`  - what-core/${subpath.slice(2)}`);
    process.exit(1);
  }
  console.log(`[publish-surface] OK: what-framework mirrors all ${Object.keys(coreExports).filter((subpath) => !isInternal(subpath)).length} app-facing what-core subpaths.`);
}

// ---------------------------------------------------------------------------
// One release of compiler and runtime per install
//
// what-compiler's output imports what-framework/render, and npm satisfies a
// dependency, or a peer it cannot share with the root, with a second copy
// nested beside the package. Only a peer on both sides conflicts at the root,
// so npm refuses `npm i what-compiler@latest` or `npm i what-framework@latest`
// alone on an app of the previous release. (packages/core/test/
// compiler-runtime-lockstep.test.js explains the layout.)
// ---------------------------------------------------------------------------

{
  const manifest = (dir) => JSON.parse(readFileSync(join(repoRoot, 'packages', dir, 'package.json'), 'utf8'));
  const compiler = manifest('compiler');
  const framework = manifest('what');
  const release = `^${compiler.version}`;
  const peerProblems = [];
  const peer = (pkg, name, optional) => {
    const range = pkg.peerDependencies?.[name];
    if (range !== release) peerProblems.push(`${pkg.name} peerDependencies["${name}"] is ${JSON.stringify(range ?? null)}, not "${release}"`);
    if ((pkg.peerDependenciesMeta?.[name]?.optional === true) !== optional) peerProblems.push(`${pkg.name}'s peer ${name} must ${optional ? '' : 'not '}be optional`);
    if (pkg.dependencies?.[name]) peerProblems.push(`${pkg.name} lists ${name} in dependencies, which npm nests instead of refusing a mix`);
  };
  peer(compiler, 'what-core', false);
  peer(compiler, 'what-framework', true);
  peer(framework, 'what-compiler', false);
  if (peerProblems.length) {
    console.error('\n[publish-surface] what-compiler and the runtime do not pin each other to one release:');
    for (const item of peerProblems) console.error(`  - ${item}`);
    process.exit(1);
  }
  console.log(`[publish-surface] OK: what-compiler and what-framework declare each other as peers at ${release}.`);
}

// ---------------------------------------------------------------------------
// Dist-content allowlist
//
// scripts/build.js cleans dist/ on every run, so after a build the ONLY files
// allowed in packages/<name>/dist are:
//   - the tier output (+ .map) of each source module an export names
//     (tierEntries: <path>.min.js for `production`, <path>.js for `module`)
//   - the sibling modules those files import, followed transitively
//   - *.d.ts type declarations
// Anything else is a stale artifact from a previous build (an "orphan") and
// would ship to npm via the `files: ["dist…"]` globs — fail loudly.
// ---------------------------------------------------------------------------

const RELATIVE_IMPORT_RE = /(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+\.js)["']/g;

const filesUnder = (dir, base = dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? filesUnder(path, base) : [relative(base, path)];
});

const distOrphans = [];
const distMissing = [];
let distCheckedPackages = 0;

for (const name of buildPackages) {
  const pkgDir = resolve(repoRoot, 'packages', name);
  const distDir = join(pkgDir, 'dist');
  if (!existsSync(distDir)) {
    // Not built yet (fresh clone) — nothing stale can ship. The release path
    // re-runs this script after `npm run build`, which validates for real.
    console.log(`[publish-surface] note: packages/${name}/dist not built; skipping dist check.`);
    continue;
  }
  distCheckedPackages += 1;

  const allowed = new Set();
  const entryFiles = [];
  const tiers = tierEntries(pkgDir);
  for (const [tier, extension] of [['production', '.min.js'], ['bundler', '.js']]) {
    for (const input of tiers[tier]) {
      const output = input.replace(/^src\//, '').replace(/\.js$/, extension);
      allowed.add(output);
      allowed.add(`${output}.map`);
      if (existsSync(join(distDir, output))) {
        entryFiles.push(output);
      } else {
        distMissing.push(`packages/${name}/dist/${output} (expected build output is missing)`);
      }
    }
  }

  // Follow relative imports transitively from this build's entry files so the
  // allowlist only contains modules and chunks that belong to the CURRENT build.
  const queue = [...entryFiles];
  const scanned = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (scanned.has(file)) continue;
    scanned.add(file);
    const content = readFileSync(join(distDir, file), 'utf8');
    for (const [, specifier] of content.matchAll(RELATIVE_IMPORT_RE)) {
      const target = relative(distDir, resolve(distDir, dirname(file), specifier));
      if (!allowed.has(target)) {
        allowed.add(target);
        allowed.add(`${target}.map`);
        if (existsSync(join(distDir, target))) queue.push(target);
      }
    }
  }

  for (const file of filesUnder(distDir).sort()) {
    if (file.endsWith('.d.ts')) continue;
    if (!allowed.has(file)) {
      distOrphans.push(`packages/${name}/dist/${file}`);
    }
  }
}

if (distOrphans.length || distMissing.length) {
  console.error('\n[publish-surface] Invalid dist contents.');
  if (distOrphans.length) {
    console.error('\nOrphan dist files (not produced by the current build config — stale artifacts would ship to npm):');
    for (const item of distOrphans) console.error(`  - ${item}`);
  }
  if (distMissing.length) {
    console.error('\nMissing expected build outputs (dist exists but is incomplete):');
    for (const item of distMissing) console.error(`  - ${item}`);
  }
  console.error('\nRun `node scripts/build.js` to regenerate dist/ from scratch.');
  process.exit(1);
}

console.log(
  `[publish-surface] OK: dist contents match the build config for ${distCheckedPackages}/${buildPackages.length} built packages (no orphans).`,
);

// ---------------------------------------------------------------------------
// Declared types files must actually ship
//
// `exports` can point a condition at a declaration file that `files` does not
// include. Nothing else catches it: the workspace resolves the path fine, and a
// consumer only discovers it after install, as "could not find a declaration
// file". 0.12.0 shipped exactly this — `exports["."].node.types` pointed at
// what-server/node.d.ts while `files` omitted it — so the check walks EVERY
// nested condition, not just the top-level `types` key.
// ---------------------------------------------------------------------------

function declaredTypesPaths(exportsField, out = new Set()) {
  if (!exportsField || typeof exportsField !== 'object') return out;
  for (const [key, value] of Object.entries(exportsField)) {
    if (key === 'types' && typeof value === 'string') out.add(value);
    else if (value && typeof value === 'object') declaredTypesPaths(value, out);
  }
  return out;
}

{
  const missing = [];
  for (const manifestPath of allowedPublicPackageJson) {
    const dir = manifestPath.replace(/\/package\.json$/, '');
    const pkg = JSON.parse(readFileSync(join(repoRoot, manifestPath), 'utf8'));
    const declared = declaredTypesPaths(pkg.exports);
    if (pkg.types) declared.add(pkg.types);
    if (pkg.typings) declared.add(pkg.typings);
    if (declared.size === 0) continue;

    const packDir = mkdtempSync(join(tmpdir(), 'what-types-pack-'));
    try {
      const output = execFileSync(
        'npm',
        ['pack', resolve(repoRoot, dir), '--pack-destination', packDir, '--silent'],
        { encoding: 'utf8' },
      );
      const tarball = resolve(packDir, output.trim().split('\n').pop() || '');
      const listing = execFileSync('tar', ['tzf', tarball], { encoding: 'utf8' })
        .split('\n')
        .map((line) => line.replace(/^package\//, '').trim())
        .filter(Boolean);
      const packed = new Set(listing);
      for (const declaredPath of declared) {
        const rel = declaredPath.replace(/^\.\//, '');
        if (!packed.has(rel)) missing.push(`${pkg.name}: exports declare types "${declaredPath}" but it is not in the published tarball (check "files")`);
      }
    } finally {
      rmSync(packDir, { recursive: true, force: true });
    }
  }

  if (missing.length > 0) {
    console.error('\nDeclared types files missing from the package tarball:');
    for (const m of missing) console.error(`  - ${m}`);
    process.exitCode = 1;
  } else {
    console.log('[publish-surface] OK: every declared `types` path is present in its package tarball.');
  }
}

// ---------------------------------------------------------------------------
// Packed declaration consumer
//
// Workspace typechecks can accidentally resolve sibling declarations through
// relative repository paths that do not exist in published tarballs. Install
// the three public packages involved in the router/server type graph into a
// clean directory, then typecheck a consumer against those packed artifacts.
// ---------------------------------------------------------------------------

const packedTypesDir = mkdtempSync(join(tmpdir(), 'what-packed-types-'));
try {
  const tarballDir = join(packedTypesDir, 'tarballs');
  const consumerDir = join(packedTypesDir, 'consumer');
  mkdirSync(tarballDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  const tarballs = [];
  for (const packageDir of [
    'packages/core',
    'packages/router',
    'packages/server',
    'packages/devtools',
    'packages/devtools-mcp',
  ]) {
    const output = execFileSync(
      'npm',
      ['pack', resolve(repoRoot, packageDir), '--pack-destination', tarballDir, '--silent'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    const filename = output.trim().split('\n').filter(Boolean).pop();
    const tarball = resolve(tarballDir, filename || '');
    if (!filename || !existsSync(tarball)) {
      throw new Error(`npm pack did not produce a tarball for ${packageDir}`);
    }
    tarballs.push(tarball);
  }

  writeFileSync(
    join(consumerDir, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs],
    { cwd: consumerDir, encoding: 'utf8' },
  );
  writeFileSync(join(consumerDir, 'consumer.ts'), `
    import { Router, type RouteConfig } from 'what-router';
    import { renderToString, type IslandStore } from 'what-server';
    // Node-only entry points live behind the package's \`node\` export condition.
    // Importing one here is the check that the condition's declarations are both
    // published AND reachable: export conditions resolve first-match, so a
    // top-level \`types\` listed before \`node\` silently shadows them.
    import { createServer, toNodeListener, exportStatic } from 'what-server';
    import type { VNode } from 'what-core';

    // The domain kits and the internal entry resolve, with their declarations,
    // through what-core's exports map.
    import { useTween, transitionClass } from 'what-core/motion';
    import { useForm } from 'what-core/form';
    import { useSWR } from 'what-core/data';
    import { FocusTrap, useIds } from 'what-core/a11y';
    import { Skeleton } from 'what-core/ui';
    import { scheduleRead, cls } from 'what-core/dom';
    import { getServerContext, IMPORT_CHANGES } from 'what-core/internal';

    const progress: number = useTween({ duration: 1 }).progress();
    const enter: string = transitionClass('fade', true).class;
    const ids: string[] = useIds(2);
    const moved: string | null = IMPORT_CHANGES[0].to;
    void [progress, enter, ids, moved, useForm, useSWR, FocusTrap, Skeleton, scheduleRead, cls, getServerContext];

    const routes: RouteConfig[] = [];
    const vnode: VNode = Router({ routes });
    renderToString(vnode);

    declare const store: IslandStore<{ count: number }>;
    store._signals.count.set(1);

    createServer({ routes: [] });
    toNodeListener(async () => new Response('ok'));
    void exportStatic;

    // The shapes a TypeScript user actually writes. Every one of these failed
    // to compile through 0.12.4, because VNode is invariant in its props type
    // and VNodeChild referred to the default \`VNode<Record<string, any>>\`:
    // any element built with typed props was rejected as a child, and so was
    // the whole tree at mount(). Nothing exercised the types from a consumer's
    // position, so nothing caught it.
    import { h, mount, Fragment, type Component, type VNodeChild } from 'what-core';

    const nested = h('div', { class: 'wrap' },
      h('h1', { style: 'font-size:48px' }, '404'),
      h('p', { style: 'color:#64748b' }, 'Page not found'),
    );
    mount(nested, 'body');
    mount(nested, document.createElement('div'));
    mount(nested, document.createDocumentFragment());

    const Card: Component<{ title: string }> = ({ title, children }) =>
      h('section', {}, h('h2', {}, title), children as VNodeChild);
    mount(h('main', {}, h(Card, { title: 'hi' }, 'body text')), 'body');
    mount(h(Fragment, {}, h('span', { id: 'a' }, 'x')), 'body');

    // what-devtools and what-devtools-mcp shipped with no declarations at all
    // through 0.13.0, so every one of these lines was an implicit \`any\` (or a
    // hard error under \`noImplicitAny\`) for a TypeScript user. The vite plugin
    // is the one that hurts most: it goes in vite.config.ts, which is the first
    // TypeScript file in the project.
    import { installDevTools, getSnapshot, type DevToolsSnapshot } from 'what-devtools';
    import { DevPanel } from 'what-devtools/panel';
    import { connectDevToolsMCP } from 'what-devtools-mcp/client';
    import whatDevToolsMCP, { DISCOVERY_PATH } from 'what-devtools-mcp/vite';

    installDevTools();
    const snap: DevToolsSnapshot = getSnapshot({ includeInternal: true });
    const firstSignalName: string | undefined = snap.signals[0]?.name;
    void firstSignalName;
    void DevPanel;

    const conn = connectDevToolsMCP({ port: 9229, token: 't' });
    const live: boolean = conn.isConnected;
    conn.disconnect();
    void live;

    const plugins = [whatDevToolsMCP({ port: 9229 })];
    const pluginName: string = plugins[0].name;
    void pluginName;
    void DISCOVERY_PATH;
  `);

  execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target', 'ES2022',
      '--module', 'NodeNext',
      '--moduleResolution', 'NodeNext',
      'consumer.ts',
    ],
    { cwd: consumerDir, encoding: 'utf8' },
  );
  console.log('[publish-surface] OK: packed what-router/what-server/what-devtools/what-devtools-mcp declarations typecheck in a clean consumer.');
} finally {
  rmSync(packedTypesDir, { recursive: true, force: true });
}
