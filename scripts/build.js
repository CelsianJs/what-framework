#!/usr/bin/env node

// What Framework - Build Script
// Builds each package's source modules with esbuild, one output file per
// module (see `packages` below), in two dist tiers beside src/ (see
// packages/core/src/env.js):
//   <path>.js      the bundler tier: readable, every dev check spelled as a
//                  process.env.NODE_ENV test, which the bundler folds
//                  (buildBundlerTier below). The `module` export condition.
//   <path>.min.js  production: the flag folded to false, so every dev-only
//                  branch, and the code only they reach, is removed
//                  (PRODUCTION below). The `production` export condition.

import { build } from 'esbuild';
import { mkdirSync, statSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, resolve, relative, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

// The packages with built tiers, in build order. Exported so
// scripts/check-publish-surface.mjs derives each dist allowlist from the same
// source of truth (tierEntries below).
//
// Every source module an export reaches is built to one output file per tier,
// importing its siblings exactly as the source does (buildModules below). Two
// requirements decide this layout:
//
// - Module state exists once per tier. Two entries that inlined one module
//   would each hold its state: what-core's component stack and tracking
//   context (`useSignal` reads one stack while the compiler's
//   `_$createComponent` pushes the other, and every production build renders
//   blank), or what-server's action registry (an
//   action registered through what-server/actions is "not found" by the
//   root's handleActionRequest under `--conditions=production`). Across
//   tiers (a component bundled from dist/*.js that a server running
//   dist/*.min.js renders), the state that is the process's is kept once for
//   all of them under Symbol.for keys on globalThis: what-core's render
//   context store, async context provider and server-process mark, its
//   devtools hooks and its streamed-boundary hook, and what-server's action
//   registry.
// - An app bundled from dist/ is as small as the same app bundled from src/.
//   A bundler drops whole modules an app never reaches only across module
//   boundaries, trusting `sideEffects: false`; inside one shared chunk it must
//   prove every statement removable, and the whole vnode renderer once hung
//   off a single kept statement. With the source's module graph, dist/
//   tree-shakes exactly like src/ under esbuild, Rollup and Rolldown
//   (scripts/check-size.mjs measures both).
export const packages = ['core', 'router', 'server', 'cache', 'what', 'compiler'];

// The source modules each tier is built from, read from the package's export
// map: every `production` target (`./dist/<path>.min.js`) and `module` target
// (`./dist/<path>.js`) is the output of the same condition object's `import`
// target, `./src/<path>.js`. Returns package-relative `src/` paths.
export function tierEntries(pkgDir) {
  const { exports } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const tiers = { production: [], bundler: [] };
  const visit = (conditions) => {
    if (typeof conditions.import === 'string') {
      const path = /^\.\/src\/(.+)\.js$/.exec(conditions.import)?.[1];
      for (const [tier, key, extension] of [['production', 'production', '.min.js'], ['bundler', 'module', '.js']]) {
        if (!(key in conditions)) continue;
        if (!path || conditions[key] !== `./dist/${path}${extension}`) {
          throw new Error(`${pkgDir}: export condition "${key}" names ${conditions[key]}, which is not the ${tier} output of ${conditions.import}`);
        }
        tiers[tier].push(`src/${path}.js`);
      }
    }
    for (const value of Object.values(conditions)) if (value && typeof value === 'object') visit(value);
  };
  for (const entry of Object.values(exports)) if (entry && typeof entry === 'object') visit(entry);
  return tiers;
}

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
// process.env.NODE_ENV is folded too, for the server and compiler modules
// that test it directly.
export const PRODUCTION = {
  define: { __WHAT_DEV__: 'false', __DEV__: 'false', 'process.env.NODE_ENV': '"production"' },
  plugins: [freeDevFlag()],
};

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

// esbuild options that build the bundler tier from `options` (their plugins
// run after the flag's).
function bundlerOptions(options) {
  return {
    ...options,
    define: { ...options.define, __DEV__: DEV_STAND_IN },
    plugins: [BUNDLER_FLAG, ...(options.plugins || [])],
  };
}

// Write esbuild's output files, spelling out the bundler tier's stand-in.
function writeOutputs(files) {
  for (const file of files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.path.endsWith('.js') ? file.text.replaceAll(DEV_STAND_IN, NODE_ENV_DEV) : file.contents);
  }
}

/** Build the bundler tier: esbuild `options` (their plugins run after the flag's). */
export async function buildBundlerTier(options) {
  const result = await build({ ...bundlerOptions(options), write: false });
  writeOutputs(result.outputFiles);
}

// Every file under `dir`, as paths relative to it.
function filesUnder(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path, base) : [relative(base, path)];
  });
}

// An import between source modules stays an import, of the sibling's output
// in the same tier: a relative import, and a package-private `#name` import
// (package.json `imports`), whose `default` target is the module the dist
// tiers read. `sideEffects: false` lets esbuild drop an import whose bindings
// the folded production code no longer uses, instead of keeping it as a bare
// `import "./x.min.js"`.
function siblingModules(pkgDir, extension) {
  const srcDir = join(pkgDir, 'src');
  const { imports = {} } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const sibling = (importer, file) => {
    const path = relative(dirname(importer), file).replace(/\.js$/, extension);
    return { path: path.startsWith('.') ? path : `./${path}`, external: true, sideEffects: false };
  };
  return {
    name: 'what-sibling-modules',
    setup(build) {
      build.onResolve({ filter: /^(\.\.?\/.*\.js|#.+)$/ }, (args) => {
        if (args.kind === 'entry-point' || !args.importer.startsWith(srcDir)) return undefined;
        if (!args.path.startsWith('#')) return sibling(args.importer, join(args.resolveDir, args.path));
        const target = imports[args.path];
        const file = typeof target === 'string' ? target : target?.default;
        if (!file) return { errors: [{ text: `${args.path} has no default target in ${pkgDir}/package.json "imports"` }] };
        return sibling(args.importer, join(pkgDir, file));
      });
    },
  };
}

// Build one tier: every module under src/ with `options`, then write only the
// outputs `entries` reach, following the imports each output kept. A module
// only a removed development branch imported is not written to the
// production tier, and a tier that no export names is not built at all.
async function buildTier(pkgDir, distDir, entries, options, extension) {
  if (entries.length === 0) return;
  const srcDir = join(pkgDir, 'src');
  const result = await build({
    ...options,
    entryPoints: filesUnder(srcDir).filter((file) => file.endsWith('.js')).map((file) => join(srcDir, file)),
    absWorkingDir: pkgDir,
    metafile: true,
    write: false,
  });
  const imports = new Map(Object.entries(result.metafile.outputs).map(([file, output]) => [resolve(pkgDir, file), output.imports]));
  const reached = new Set();
  const queue = entries.map((entry) => join(distDir, relative(srcDir, join(pkgDir, entry)).replace(/\.js$/, extension)));
  while (queue.length) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    if (!imports.has(file)) throw new Error(`${relative(root, file)}: an export names it, but no module builds it`);
    reached.add(file);
    for (const { path, external } of imports.get(file)) if (external && path.startsWith('.')) queue.push(resolve(dirname(file), path));
  }
  writeOutputs(result.outputFiles.filter((file) => reached.has(file.path.replace(/\.map$/, ''))));
}

// Both tiers build on the neutral platform: on the browser platform esbuild
// defines process.env.NODE_ENV itself ("development" unless it minifies),
// which would fold what-server's own runtime checks of it (whether an error's
// message may reach the page) into the bundler tier.
//
// The production tier keeps its whitespace: esbuild drops `/* @__PURE__ */`
// annotations when it minifies whitespace, and they are what lets an app's
// bundler remove an unused definition such as `Suspense` (components.js) or a
// vnode producer and the renderer it installs (h.js). Every app bundler
// minifies again, so the whitespace never reaches an app.
export async function buildModules(pkgDir, distDir) {
  const tiers = tierEntries(pkgDir);
  const common = {
    outbase: join(pkgDir, 'src'),
    outdir: distDir,
    bundle: true,
    packages: 'external',
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    sourcemap: 'external',
    logLevel: 'silent',
  };
  await buildTier(pkgDir, distDir, tiers.bundler, bundlerOptions({ ...common, plugins: [siblingModules(pkgDir, '.js')] }), '.js');
  await buildTier(pkgDir, distDir, tiers.production, {
    ...common,
    ...PRODUCTION,
    plugins: [...PRODUCTION.plugins, siblingModules(pkgDir, '.min.js')],
    minifySyntax: true,
    minifyIdentifiers: true,
    entryNames: '[dir]/[name].min',
  }, '.min.js');
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

  for (const name of packages) {
    const pkgDir = join(root, 'packages', name);
    const distDir = join(pkgDir, 'dist');
    // Clean before every build so dist/ is reproducible: an output a previous
    // build wrote and this one does not must never ship.
    rmSync(distDir, { recursive: true, force: true });
    mkdirSync(distDir, { recursive: true });

    try {
      await buildModules(pkgDir, distDir);
    } catch (err) {
      failed = true;
      console.error(`  ERROR building ${name}: ${err.message}`);
      continue;
    }

    const bundle = distBytes(distDir, false);
    const minified = distBytes(distDir, true);
    totalBundle += bundle;
    totalMinified += minified;
    console.log(`  @what/${name}  bundler ${formatSize(bundle)}  production ${formatSize(minified)}  (per module)`);
  }

  console.log(`\n  Total:  bundler ${formatSize(totalBundle)}  production ${formatSize(totalMinified)}`);
  if (failed) {
    process.exitCode = 1;
    console.error('  Build failed; see the diagnostics above.\n');
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
