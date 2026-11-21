// What each published specifier of the workspace exports, read statically.
//
// Specifiers resolve through each package's own `exports` map, as
// docs-site/scripts/check-api-refs.mjs does, so a subpath that is not published
// is reported even when the file behind it exists. Export names are read from
// the source with the parser instead of by importing the module: a package with
// a `bin` runs when imported (an MCP server on stdio, a scaffold prompt), and
// reading the declarations answers the same question with no side effects.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from '@babel/parser';

const SKIPPED_CONDITIONS = new Set(['production', 'development']);
const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);

function targetsOf(value, out = { js: [], types: [], other: [] }, condition = null) {
  if (typeof value === 'string') {
    if (condition === 'types' || value.endsWith('.d.ts')) out.types.push(value);
    else if (/\.(?:m?js|jsx|cjs)$/.test(value)) out.js.push(value);
    else out.other.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) targetsOf(v, out, condition);
  } else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (SKIPPED_CONDITIONS.has(key)) continue;
      targetsOf(v, out, key === 'types' ? 'types' : condition);
    }
  }
  return out;
}

/**
 * Every published workspace package: name, directory, whether it has a `bin`,
 * and per export subpath the JavaScript files (every condition except
 * `production`/`development`, which point at build output) and declaration files.
 */
export function workspacePackages(repo) {
  const packages = new Map();
  const dir = join(repo, 'packages');
  for (const entry of readdirSync(dir)) {
    let manifest;
    try { manifest = JSON.parse(readFileSync(join(dir, entry, 'package.json'), 'utf8')); } catch { continue; }
    if (!manifest.name || manifest.private) continue;
    const root = join(dir, entry);
    const exportsField = manifest.exports
      ?? (manifest.main ? { '.': `./${manifest.main.replace(/^\.\//, '')}` } : {});
    const map = typeof exportsField === 'string' || Array.isArray(exportsField) || !Object.keys(exportsField).some((k) => k.startsWith('.'))
      ? { '.': exportsField }
      : exportsField;
    const subpaths = new Map();
    for (const [subpath, value] of Object.entries(map)) {
      const t = targetsOf(value);
      subpaths.set(subpath, {
        js: [...new Set(t.js)].map((f) => resolve(root, f)),
        types: [...new Set(t.types)].map((f) => resolve(root, f)),
        other: t.other.length > 0,
      });
    }
    packages.set(manifest.name, {
      name: manifest.name,
      dir: root,
      bin: Boolean(manifest.bin),
      dependencies: new Set([...Object.keys(manifest.dependencies || {}), ...Object.keys(manifest.peerDependencies || {})]),
      subpaths,
    });
  }
  return packages;
}

/** Split a bare specifier into package name and `./subpath`. */
export function splitSpecifier(spec) {
  const parts = spec.split('/');
  const nameLength = spec.startsWith('@') ? 2 : 1;
  const name = parts.slice(0, nameLength).join('/');
  const rest = parts.slice(nameLength).join('/');
  return { name, subpath: rest ? `./${rest}` : '.' };
}

function matchSubpath(subpaths, subpath) {
  if (subpaths.has(subpath)) return subpaths.get(subpath);
  for (const [pattern, target] of subpaths) {
    const star = pattern.indexOf('*');
    if (star === -1) continue;
    const head = pattern.slice(0, star);
    const tail = pattern.slice(star + 1);
    if (subpath.startsWith(head) && subpath.endsWith(tail) && subpath.length >= head.length + tail.length) {
      const fill = subpath.slice(head.length, subpath.length - tail.length);
      const sub = (files) => files.map((f) => f.replace('*', fill)).filter((f) => existsSync(f));
      return { js: sub(target.js), types: sub(target.types), other: target.other };
    }
  }
  return null;
}

export class Exports {
  constructor(repo) {
    this.repo = repo;
    this.packages = workspacePackages(repo);
    this.valueCache = new Map();
    this.typeCache = new Map();
    this.fsCache = new Map();
  }

  /** True when the specifier names a workspace package, or looks like one of ours (`what`, `what/x`, `what-x`). */
  isOurs(spec) {
    return this.packages.has(splitSpecifier(spec).name) || /^what(?:[-/]|$)/.test(spec);
  }

  /**
   * Resolve a specifier of ours.
   * @returns {{ pkg: object, subpath: string, entry: { js: string[], types: string[] } } | { error: string }}
   */
  resolve(spec) {
    const { name, subpath } = splitSpecifier(spec);
    const pkg = this.packages.get(name);
    if (!pkg) return { error: `'${name}' is not a published What package` };
    const entry = matchSubpath(pkg.subpaths, subpath);
    if (!entry) return { error: `'${spec}' is not an entry point of ${name} (its exports map has ${[...pkg.subpaths.keys()].join(', ')})` };
    return { pkg, subpath, entry };
  }

  /**
   * Value export names of a specifier, union over its conditions, each mapped
   * to the file that declares it. `open` means some names could not be read.
   */
  valueExports(spec) {
    const r = this.resolve(spec);
    if (r.error) return null;
    return union(r.entry.js.map((f) => this.moduleExports(f, false)));
  }

  /** Type-level export names of a specifier, from its declaration files. */
  typeExports(spec) {
    const r = this.resolve(spec);
    if (r.error) return null;
    if (r.entry.types.length === 0) return { names: new Map(), open: true };
    return union(r.entry.types.map((f) => this.moduleExports(f, true)));
  }

  /** True when the module that declares `name` (as `spec` exports it) imports the file system. */
  readsFiles(spec, name) {
    const origin = this.valueExports(spec)?.names.get(name);
    return Boolean(origin) && this.importsFileSystem(origin);
  }

  // Only called with a file moduleExports() parsed, so the parse cannot fail.
  importsFileSystem(file) {
    if (!this.fsCache.has(file)) {
      const source = readFileSync(file, 'utf8');
      const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
      const sources = [
        ...ast.program.body.filter((n) => n.type === 'ImportDeclaration').map((n) => n.source.value),
        ...[...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
      ];
      this.fsCache.set(file, sources.some((src) => FS_MODULES.has(src)));
    }
    return this.fsCache.get(file);
  }

  moduleExports(file, dts, visiting = new Set()) {
    const cache = dts ? this.typeCache : this.valueCache;
    if (cache.has(file)) return cache.get(file);
    if (visiting.has(file)) return { names: new Map(), open: false };
    visiting.add(file);
    const result = { names: new Map(), open: false };
    let ast;
    try {
      ast = parse(readFileSync(file, 'utf8'), {
        sourceType: 'module',
        plugins: dts ? [['typescript', { dts: true }]] : ['jsx'],
      });
    } catch {
      result.open = true;
      cache.set(file, result);
      return result;
    }
    const from = (source) => this.resolveModule(file, source, dts);
    for (const node of ast.program.body) {
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration) for (const name of declaredNames(node.declaration)) result.names.set(name, file);
        const targets = node.source ? from(node.source.value) : null;
        for (const s of node.specifiers) {
          const local = s.local ? exportedName(s.local) : null;
          let origin = file;
          if (targets && local) {
            for (const target of targets) {
              const inner = this.moduleExports(target, dts, visiting).names.get(local);
              if (inner) { origin = inner; break; }
            }
          }
          result.names.set(exportedName(s.exported), origin);
        }
      } else if (node.type === 'ExportDefaultDeclaration') {
        result.names.set('default', file);
      } else if (node.type === 'ExportAllDeclaration') {
        if (node.exported) {
          result.names.set(exportedName(node.exported), file);
          continue;
        }
        const targets = from(node.source.value);
        if (!targets) { result.open = true; continue; }
        for (const target of targets) {
          const inner = this.moduleExports(target, dts, visiting);
          if (inner.open) result.open = true;
          for (const [name, origin] of inner.names) if (name !== 'default' && !result.names.has(name)) result.names.set(name, origin);
        }
      } else if (node.type === 'TSExportAssignment') {
        result.open = true;
      }
    }
    visiting.delete(file);
    cache.set(file, result);
    return result;
  }

  // Files a module source inside a package resolves to, or null when it leaves the workspace.
  resolveModule(fromFile, source, dts) {
    if (source.startsWith('.')) {
      const base = resolve(dirname(fromFile), source);
      const candidates = dts
        ? [base.replace(/\.(?:m?js|jsx)$/, '.d.ts'), `${base}.d.ts`, join(base, 'index.d.ts'), base]
        : [base, `${base}.js`, join(base, 'index.js')];
      const hit = candidates.find((c) => isFile(c) && (!dts || c.endsWith('.d.ts')));
      return hit ? [hit] : null;
    }
    const r = this.resolve(source);
    if (r.error) return null;
    const files = dts ? r.entry.types : r.entry.js;
    return files.length ? files : null;
  }
}

function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

function union(results) {
  const out = { names: new Map(), open: false };
  for (const r of results) {
    if (r.open) out.open = true;
    for (const [name, origin] of r.names) if (!out.names.has(name)) out.names.set(name, origin);
  }
  if (results.length === 0) out.open = true;
  return out;
}

function exportedName(node) {
  return node.type === 'StringLiteral' ? node.value : node.name;
}

function declaredNames(decl) {
  if (decl.type === 'VariableDeclaration') return decl.declarations.flatMap((d) => patternNames(d.id));
  if (decl.id && decl.id.type === 'Identifier') return [decl.id.name];
  return [];
}

function patternNames(node) {
  if (!node) return [];
  switch (node.type) {
    case 'Identifier': return [node.name];
    case 'ObjectPattern': return node.properties.flatMap((p) => patternNames(p.type === 'RestElement' ? p.argument : p.value));
    case 'ArrayPattern': return node.elements.flatMap((e) => patternNames(e));
    case 'AssignmentPattern': return patternNames(node.left);
    case 'RestElement': return patternNames(node.argument);
    default: return [];
  }
}
