#!/usr/bin/env node
// Type parity check: every value declared in a .d.ts must actually be exported
// by the runtime entry it describes. Catches phantom declarations that typecheck
// clean and then throw "does not provide an export named X" at module load.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

export function declaredValues(source, typeNames = new Set()) {
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

export async function checkParity() {
  const failures = [];
  const skipped = [];
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
        mod = await import(pathToFileURL(runtime).href);
      } catch (err) {
        skipped.push(`${types.slice(root.length + 1)}: cannot import ${runtime.slice(root.length + 1)} (${err.message})`);
        continue;
      }
      checked++;
      const runtimeNames = new Set(Object.keys(mod));
      const phantoms = [...declaredValues(readFileSync(types, 'utf8'), typeNames)]
        .filter((n) => !runtimeNames.has(n))
        .sort();
      if (phantoms.length) {
        failures.push({ types: types.slice(root.length + 1), phantoms });
      }
    }
  }

  for (const s of skipped) console.log(`skip  ${s}`);
  for (const f of failures) {
    console.log(`FAIL  ${f.types}`);
    for (const p of f.phantoms) console.log(`        phantom export: ${p}`);
  }
  console.log(`\n${checked} declaration file(s) checked, ${failures.length} with phantom exports.`);
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if ((await checkParity()).length) process.exit(1);
}
