#!/usr/bin/env node

// What Framework - Build Script
// Uses esbuild to produce proper ESM bundles per package, in two dist tiers
// beside src/ (see packages/core/src/env.js):
//   <entry>.js      for bundlers: readable, every dev check spelled as a
//                   process.env.NODE_ENV test, which the bundler folds
//                   (buildBundlerTier below). The `module` export condition.
//   <entry>.min.js  production: minified, the flag folded to false so every
//                   dev-only branch, and the code only they reach, is
//                   removed (PRODUCTION below). The `production` export
//                   condition.

import { build } from 'esbuild';
import { mkdirSync, existsSync, statSync, rmSync, readdirSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, resolve, relative, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

// Package build configurations
// Each entry: { name, entries: [{ input, outputBase }], external }
// Exported so scripts/check-publish-surface.mjs can derive the per-package
// dist allowlist from the same source of truth.
export const packages = [
  {
    name: 'core',
    // The export map's targets. Every other module under src/ is built too:
    // see `modules` below.
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
      { input: 'src/render.js', outputBase: 'render' },
      { input: 'src/jsx-runtime.js', outputBase: 'jsx-runtime' },
      { input: 'src/jsx-dev-runtime.js', outputBase: 'jsx-dev-runtime' },
      { input: 'src/testing.js', outputBase: 'testing' },
      { input: 'src/entries/a11y.js', outputBase: 'entries/a11y' },
      { input: 'src/entries/ui.js', outputBase: 'entries/ui' },
      { input: 'src/entries/motion.js', outputBase: 'entries/motion' },
      { input: 'src/entries/dom.js', outputBase: 'entries/dom' },
      { input: 'src/entries/form.js', outputBase: 'entries/form' },
      { input: 'src/entries/data.js', outputBase: 'entries/data' },
      { input: 'src/entries/internal.js', outputBase: 'entries/internal' },
      { input: 'src/markup-rules.js', outputBase: 'markup-rules' },
    ],
    external: [],
    // One output file per source module, importing its siblings exactly as the
    // source does (buildModules below). Two requirements decide this layout:
    //
    // - Shared state exists once. dom.js's component stack and reactive.js's
    //   tracking context must be the same instance for every entry, or
    //   `useSignal` reads one stack while the compiler's `_$createComponent`
    //   pushes the other and every production build renders blank
    //   (AUDIT-2026-06-06.md C1).
    // - An app bundled from dist/ is as small as the same app bundled from
    //   src/. A bundler drops whole modules an app never reaches only across
    //   module boundaries, trusting `sideEffects: false`; inside one shared
    //   chunk it must prove every statement removable, and the whole vnode
    //   renderer once hung off a single kept statement. With the source's
    //   module graph, dist/ tree-shakes exactly like src/ under esbuild, Rollup
    //   and Rolldown (scripts/check-size.mjs measures both).
    modules: true,
  },
  {
    name: 'router',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
      // what-router/match is a public subpath (exports map references
      // dist/match.min.js) consumed by what-server's deploy adapters — it
      // MUST be built or `--conditions=production` resolution dangles.
      { input: 'src/match.js', outputBase: 'match' },
    ],
    external: ['what-core'],
  },
  {
    name: 'server',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
      { input: 'src/node.js', outputBase: 'node' },
      { input: 'src/islands.js', outputBase: 'islands' },
      { input: 'src/actions.js', outputBase: 'actions' },
      { input: 'src/ssr-runtime.js', outputBase: 'ssr-runtime' },
    ],
    // what-router/what-isr are optional peers (kept external, not inlined); the
    // deploy adapters lazy-import Node builtins which must not be bundled.
    external: ['what-core', 'what-router', 'what-router/match', 'what-isr', 'node:async_hooks', 'node:fs/promises', 'node:http', 'node:module', 'node:path', 'node:url'],
  },
  {
    // Origin-first ISR engine. Zero runtime deps; Node-only builtins stay external.
    name: 'cache',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
    ],
    external: ['node:crypto', 'node:fs/promises', 'node:path'],
  },
  {
    name: 'what',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
      { input: 'src/render.js', outputBase: 'render' },
      { input: 'src/router.js', outputBase: 'router' },
      { input: 'src/server.js', outputBase: 'server' },
      { input: 'src/ssr-runtime.js', outputBase: 'ssr-runtime' },
      { input: 'src/jsx-runtime.js', outputBase: 'jsx-runtime' },
      { input: 'src/jsx-dev-runtime.js', outputBase: 'jsx-dev-runtime' },
      { input: 'src/testing.js', outputBase: 'testing' },
      { input: 'src/a11y.js', outputBase: 'a11y' },
      { input: 'src/ui.js', outputBase: 'ui' },
      { input: 'src/motion.js', outputBase: 'motion' },
      { input: 'src/dom.js', outputBase: 'dom' },
      { input: 'src/form.js', outputBase: 'form' },
      { input: 'src/data.js', outputBase: 'data' },
    ],
    external: ['what-core', 'what-router', 'what-server', 'what-compiler'],
  },
  {
    name: 'compiler',
    entries: [
      { input: 'src/index.js', outputBase: 'index' },
      { input: 'src/babel-plugin.js', outputBase: 'babel-plugin' },
      { input: 'src/vite-plugin.js', outputBase: 'vite-plugin' },
      { input: 'src/runtime.js', outputBase: 'runtime' },
      { input: 'src/file-router.js', outputBase: 'file-router' },
    ],
    // 'vite' is the host tool — the vite-plugin's dynamic import('vite')
    // (version detection) must stay external or esbuild drags all of
    // vite+esbuild into the bundle and these entries fail to build.
    external: ['@babel/core', 'what-core', 'vite', 'fs', 'path', 'url', 'node:module'],
  },
];

// The production tier. esbuild inlines an imported constant only while
// linking, after dead-code elimination and tree shaking, so `if (__DEV__)
// report()` would lose the call but keep report() and everything it imports.
// Instead, each module's `__DEV__` import is blanked out (same length, so the
// source maps stay exact) and the identifier, now free, is defined as `false`,
// which esbuild folds while parsing: dev branches go, then whatever only they
// used. Modules must import the flag as `__DEV__`, unrenamed.
const DEV_IMPORT = /\bimport\s*\{([^}]*)\}\s*from\b/g;
// `env`, when given, replaces the source of core's env.js, the module that
// declares the flag.
function freeDevFlag(env) {
  return {
    name: 'what-dev-flag',
    setup(build) {
      build.onLoad({ filter: /[\\/]packages[\\/][^\\/]+[\\/]src[\\/].*\.js$/ }, async (args) => {
        if (env && /[\\/]packages[\\/]core[\\/]src[\\/]env\.js$/.test(args.path)) return { contents: env, loader: 'js' };
        const source = await readFile(args.path, 'utf8');
        if (!source.includes('__DEV__')) return undefined;
        const contents = source.replace(DEV_IMPORT, (statement, specifiers) => statement.replace(
          specifiers,
          specifiers.replace(/\b__DEV__\b(?!\s+as\b)(\s*,)?/, (match) => ' '.repeat(match.length)),
        ));
        return { contents, loader: 'js' };
      });
    },
  };
}
export const PRODUCTION = { define: { __WHAT_DEV__: 'false', __DEV__: 'false' }, plugins: [freeDevFlag()] };

// The bundler tier. A browser bundle made with neither the `development` nor
// the `production` condition resolves `module` to it: esbuild with its default
// conditions, `bun build --production`. (`node` comes before `module` in the
// export maps, so a server bundle resolves the source, as Node itself does.)
// Both define process.env.NODE_ENV (esbuild: "production" when minifying for
// the browser, else "development"), so each `__DEV__` is spelled as that test
// in place: a production build folds every dev branch while parsing and drops
// the code only it reaches, as the production tier does, and a development
// build keeps the diagnostics. The __WHAT_DEV__ global plays no part here.
// esbuild is handed a stand-in identifier of the test's length, spelled out in
// the output, so the source maps stay exact.
const NODE_ENV_DEV = '(process.env.NODE_ENV !== "production")';
const DEV_STAND_IN = `__WHAT_DEV_${'_'.repeat(NODE_ENV_DEV.length - '__WHAT_DEV_'.length)}`;
const BUNDLER_FLAG = freeDevFlag(`export const __DEV__ = ${DEV_STAND_IN};\n`);

/** Build the bundler tier: esbuild `options` (their plugins run after the flag's). */
export async function buildBundlerTier(options) {
  const result = await build({
    ...options,
    define: { ...options.define, __DEV__: DEV_STAND_IN },
    plugins: [BUNDLER_FLAG, ...(options.plugins || [])],
    write: false,
  });
  for (const file of result.outputFiles) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.path.endsWith('.js') ? file.text.replaceAll(DEV_STAND_IN, NODE_ENV_DEV) : file.contents);
  }
}

// Every file under `dir`, as paths relative to it.
function filesUnder(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path, base) : [relative(base, path)];
  });
}

// A relative import between source modules stays an import, of the sibling's
// output in the same tier. `sideEffects: false` lets esbuild drop an import
// whose bindings the folded production code no longer uses, instead of
// keeping it as a bare `import "./x.min.js"`.
function siblingModules(srcDir, extension) {
  return {
    name: 'what-sibling-modules',
    setup(build) {
      build.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
        if (args.kind === 'entry-point' || !args.importer.startsWith(srcDir)) return undefined;
        return { path: args.path.replace(/\.js$/, extension), external: true, sideEffects: false };
      });
    },
  };
}

// The production tier keeps its whitespace: esbuild drops `/* @__PURE__ */`
// annotations when it minifies whitespace, and they are what lets an app's
// bundler remove an unused definition such as `Suspense` (components.js) or a
// vnode producer and the renderer it installs (h.js). Every app bundler
// minifies again, so the whitespace never reaches an app.
export async function buildModules(pkgDir, distDir) {
  const srcDir = join(pkgDir, 'src');
  const common = {
    entryPoints: existsSync(srcDir)
      ? filesUnder(srcDir).filter((file) => file.endsWith('.js')).map((file) => join(srcDir, file))
      : [],
    outbase: srcDir,
    outdir: distDir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  };
  await buildBundlerTier({ ...common, plugins: [siblingModules(srcDir, '.js')], sourcemap: 'external' });
  await build({
    ...common,
    ...PRODUCTION,
    plugins: [...PRODUCTION.plugins, siblingModules(srcDir, '.min.js')],
    minifySyntax: true,
    minifyIdentifiers: true,
    sourcemap: 'external',
    entryNames: '[dir]/[name].min',
  });
}

// Bytes of one tier: `.min.js` files, or the readable `.js` files beside them.
function distBytes(distDir, minified) {
  return filesUnder(distDir)
    .filter((file) => file.endsWith('.js') && file.endsWith('.min.js') === minified)
    .reduce((total, file) => total + statSync(join(distDir, file)).size, 0);
}

async function runBuild() {
console.log('\n  Building What Framework with esbuild...\n');

let totalBundle = 0;
let totalMinified = 0;
let failed = false;

for (const pkg of packages) {
  const pkgDir = join(root, 'packages', pkg.name);
  const distDir = join(pkgDir, 'dist');
  // Clean before every build so dist/ is reproducible — stale chunk-<hash>
  // generations and orphaned entries must never accumulate (and never ship).
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  let pkgBundle = 0;
  let pkgMinified = 0;

  if (pkg.modules) {
    try {
      await buildModules(pkgDir, distDir);
      pkgBundle = distBytes(distDir, false);
      pkgMinified = distBytes(distDir, true);
    } catch (err) {
      failed = true;
      console.error(`  ERROR building ${pkg.name} (modules): ${err.message}`);
    }

    totalBundle += pkgBundle;
    totalMinified += pkgMinified;
    const ratio = pkgBundle > 0 ? ((1 - pkgMinified / pkgBundle) * 100).toFixed(0) : 0;
    console.log(
      `  @what/${pkg.name}  bundle ${formatSize(pkgBundle)}  min ${formatSize(pkgMinified)}  (${ratio}% minification, per module)`
    );
    continue;
  }

  for (const entry of pkg.entries) {
    const entryPath = join(pkgDir, entry.input);
    if (!existsSync(entryPath)) continue;

    try {
      // The bundler tier, readable. Maps here and below are emitted locally,
      // without a sourceMappingURL comment: they are not in the npm payload.
      await buildBundlerTier({
        entryPoints: [entryPath],
        outfile: join(distDir, `${entry.outputBase}.js`),
        bundle: true,
        format: 'esm',
        platform: 'browser',
        sourcemap: 'external',
        treeShaking: true,
        external: pkg.external,
        minify: false,
        target: 'es2022',
        logLevel: 'silent',
      });

      // Minified bundle
      await build({
        entryPoints: [entryPath],
        outfile: join(distDir, `${entry.outputBase}.min.js`),
        bundle: true,
        format: 'esm',
        platform: 'browser',
        sourcemap: 'external',
        treeShaking: true,
        external: pkg.external,
        minify: true,
        ...PRODUCTION,
        target: 'es2022',
        logLevel: 'silent',
      });

      const bundlePath = join(distDir, `${entry.outputBase}.js`);
      const minPath = join(distDir, `${entry.outputBase}.min.js`);
      const bundleSize = existsSync(bundlePath) ? statSync(bundlePath).size : 0;
      const minSize = existsSync(minPath) ? statSync(minPath).size : 0;

      pkgBundle += bundleSize;
      pkgMinified += minSize;
    } catch (err) {
      failed = true;
      console.error(`  ERROR building ${pkg.name}/${entry.input}: ${err.message}`);
    }
  }

  totalBundle += pkgBundle;
  totalMinified += pkgMinified;

  const ratio = pkgBundle > 0
    ? ((1 - pkgMinified / pkgBundle) * 100).toFixed(0)
    : 0;
  console.log(
    `  @what/${pkg.name}  bundle ${formatSize(pkgBundle)}  min ${formatSize(pkgMinified)}  (${ratio}% minification)`
  );
}

const totalRatio = totalBundle > 0
  ? ((1 - totalMinified / totalBundle) * 100).toFixed(0)
  : 0;
console.log(
  `\n  Total:  bundle ${formatSize(totalBundle)}  min ${formatSize(totalMinified)}  (${totalRatio}% minification)`
);
if (failed) {
  process.exitCode = 1;
  console.error('  Build failed; see entry diagnostics above.\n');
} else {
  console.log('  Done!\n');
}
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' kB';
}

// Only build when executed directly (`node scripts/build.js`) — importing this
// module (e.g. from check-publish-surface.mjs) must be side-effect free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runBuild();
}
