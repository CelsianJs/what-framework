#!/usr/bin/env node
// Type parity check, both directions.
//
// Forward:  every value declared in a .d.ts must actually be exported by the
//           runtime entry it describes. Catches phantom declarations that
//           typecheck clean and then throw "does not provide an export named X"
//           at module load: the type system, the thing the user trusts to catch
//           this, is the thing lying.
//
// Reverse:  every value the runtime exports must be declared. A one-directional
//           gate lets a shipped feature be invisible to every TypeScript user,
//           which is how a capability gets built and then never adopted.

import { readFileSync, existsSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(root, 'packages');

// Runtime entries that cannot be imported in a bare Node process (browser-only
// globals, bundler-only resolution). Parity is not checkable for these.
const SKIP_PACKAGES = new Set(['create-what']);

const VALUE_DECL = /^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/gm;
const NAMED_BLOCK = /^export\s*\{([^}]*)\}/gm;
const TYPE_ONLY = /^(?:export\s+)?(?:declare\s+)?(?:interface|type|namespace)\s+([A-Za-z_$][\w$]*)/gm;

// `export * from 'x'` re-exports every name the target declares. A checker that
// does not follow it reports a correct barrel as 260 undeclared exports, which is
// how a reverse-direction gate ends up disabled instead of fixed.
const STAR_REEXPORT = /^export\s+\*\s+from\s+['"]([^'"]+)['"]/gm;

// Map bare package specifiers back to their declaration file in this monorepo.
let _pkgTypesByName = null;
function packageTypesPath(spec) {
  if (!_pkgTypesByName) {
    _pkgTypesByName = new Map();
    for (const dir of readdirSync(packagesDir)) {
      const manifest = join(packagesDir, dir, 'package.json');
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      // The checker imports the runtime in Node, so it must resolve the types
      // Node itself would: the `node` condition's declarations win when present.
      const types = pkg.exports?.['.']?.node?.types
        || pkg.exports?.['.']?.types
        || pkg.types || pkg.typings;
      if (pkg.name && types) _pkgTypesByName.set(pkg.name, join(packagesDir, dir, types));
    }
  }
  return _pkgTypesByName.get(spec) || null;
}

function resolveStarTarget(spec, fromFile) {
  if (spec.startsWith('.')) {
    const base = resolve(dirname(fromFile), spec).replace(/\.js$/, '');
    for (const candidate of [`${base}.d.ts`, base, join(base, 'index.d.ts')]) {
      if (existsSync(candidate) && candidate.endsWith('.d.ts')) return candidate;
    }
    return null;
  }
  // Bare specifier, possibly a subpath like 'what-core/render'.
  const direct = packageTypesPath(spec);
  if (direct && existsSync(direct)) return direct;
  const slash = spec.indexOf('/');
  if (slash > 0) {
    const owner = packageTypesPath(spec.slice(0, slash));
    if (owner) {
      const candidate = join(dirname(owner), `${spec.slice(slash + 1)}.d.ts`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function declaredValues(source, typeNames = new Set(), file = null, seen = new Set()) {
  const names = new Set();
  for (const m of source.matchAll(VALUE_DECL)) names.add(m[1]);
  for (const m of source.matchAll(NAMED_BLOCK)) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim();
      if (!part || part.startsWith('type ')) continue;
      const alias = part.split(/\s+as\s+/);
      names.add((alias[1] || alias[0]).trim());
    }
  }

  if (file) {
    for (const m of source.matchAll(STAR_REEXPORT)) {
      const target = resolveStarTarget(m[1], file);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      const targetTypes = packageTypeNames(dirname(target));
      for (const n of declaredValues(readFileSync(target, 'utf8'), targetTypes, target, seen)) {
        names.add(n);
      }
    }
  }

  for (const t of typeNames) names.delete(t);
  names.delete('default');
  return names;
}

// A name declared as a type/interface/namespace anywhere in the package's
// declarations is a type, even when re-exported from a sibling file.
export function packageTypeNames(pkgDir) {
  const typeNames = new Set();
  for (const file of readdirSync(pkgDir)) {
    if (!file.endsWith('.d.ts')) continue;
    const src = readFileSync(join(pkgDir, file), 'utf8');
    for (const m of src.matchAll(TYPE_ONLY)) typeNames.add(m[1]);
  }
  return typeNames;
}

function entriesFor(pkgDir, pkg) {
  const pairs = [];
  const add = (types, runtime) => {
    if (!types || !runtime) return;
    const t = join(pkgDir, types);
    const r = join(pkgDir, runtime);
    if (!existsSync(t) || !existsSync(r)) return;
    if (pairs.some((p) => p.types === t)) return;
    pairs.push({ types: t, runtime: r });
  };

  const exp = pkg.exports;
  if (exp && typeof exp === 'object') {
    for (const cond of Object.values(exp)) {
      if (!cond || typeof cond !== 'object') continue;
      add(cond.types, cond.import || cond.default);
    }
  }
  add(pkg.types || pkg.typings, pkg.main || pkg.module);

  // .d.ts files that sit next to a same-named source file but are not wired
  // through exports (subpath entries consumers still reach via deep import).
  for (const file of readdirSync(pkgDir)) {
    if (!file.endsWith('.d.ts')) continue;
    const base = file.slice(0, -5);
    add(file, `src/${base}.js`);
  }
  return pairs;
}

// `what-devtools/panel` is authored in JSX, and Node cannot import a `.jsx`
// file. Reporting it unimportable would be right but useless: the entry is
// published, its declarations are published, and nothing would ever check one
// against the other. Compile it the way the framework does and import that.
//
// The compiled file is written NEXT TO its source rather than in a temp dir, so
// every specifier inside it — relative (`./index.js`) and bare (`what-core`,
// resolved through the workspace link) — resolves exactly as it does for the
// original. A temp dir breaks both.
const jsxTemps = new Set();
let jsxModuleId = 0;
process.on('exit', () => {
  for (const file of jsxTemps) { try { rmSync(file, { force: true }); } catch {} }
});

async function importRuntime(runtime) {
  if (!runtime.endsWith('.jsx')) return import(pathToFileURL(runtime).href);

  const [{ transformSync }, { default: babelPlugin }] = await Promise.all([
    import('@babel/core'),
    import('../packages/compiler/src/babel-plugin.js'),
  ]);
  const code = transformSync(readFileSync(runtime, 'utf8'), {
    filename: runtime,
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
  }).code;

  const file = join(dirname(runtime), `.type-parity-${jsxModuleId++}.mjs`);
  jsxTemps.add(file);
  writeFileSync(file, code);

  // Compiled output calls `_$template()` at module scope, which needs a
  // document. Install one only for this import and take it back down after, so
  // the rest of the run stays in a bare Node process.
  const { installDOM } = await import('../test-utils/dom.js');
  const { cleanup } = installDOM();
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    cleanup();
    rmSync(file, { force: true });
    jsxTemps.delete(file);
  }
}

export async function checkParity() {
  const failures = [];
  let checked = 0;

  for (const name of readdirSync(packagesDir).sort()) {
    const pkgDir = join(packagesDir, name);
    const manifest = join(pkgDir, 'package.json');
    if (!existsSync(manifest)) continue;
    if (SKIP_PACKAGES.has(name)) continue;
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    const typeNames = packageTypeNames(pkgDir);

    for (const { types, runtime } of entriesFor(pkgDir, pkg)) {
      let mod;
      try {
        mod = await importRuntime(runtime);
      } catch (err) {
        // A silent skip is a hole in the gate: an entry nobody can import is an
        // entry nobody is checking. Report it as a failure and let SKIP_PACKAGES
        // record the deliberate exceptions.
        failures.push({
          types: types.slice(root.length + 1),
          phantoms: [],
          unimportable: `cannot import ${runtime.slice(root.length + 1)} (${err.message})`,
        });
        continue;
      }
      checked++;
      const runtimeNames = new Set(Object.keys(mod));
      const declared = declaredValues(readFileSync(types, 'utf8'), typeNames, types);

      const phantoms = [...declared].filter((n) => !runtimeNames.has(n)).sort();

      // Internal exports (leading underscore) are deliberately undeclared, and
      // `default` is not a named value.
      const undeclared = [...runtimeNames]
        .filter((n) => n !== 'default' && !n.startsWith('_') && !declared.has(n) && !typeNames.has(n))
        .sort();

      if (phantoms.length || undeclared.length) {
        failures.push({ types: types.slice(root.length + 1), phantoms, undeclared });
      }
    }
  }

  for (const f of failures) {
    console.log(`FAIL  ${f.types}`);
    if (f.unimportable) console.log(`        ${f.unimportable}`);
    for (const p of f.phantoms) console.log(`        declared but not exported: ${p}`);
    for (const u of f.undeclared || []) console.log(`        exported but not declared: ${u}`);
  }
  console.log(`\n${checked} declaration file(s) checked, ${failures.length} problem(s).`);
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if ((await checkParity()).length) process.exit(1);
}
