/**
 * Mixed JSX: native What files and React files in one Vite app, both written
 * as plain JSX. Installed by reactCompat() when the app also uses
 * what-compiler's plugin (what() from what-compiler/vite). See MIXED.md.
 *
 * Every .jsx/.tsx file of the app is one of two kinds:
 *
 * - A React file: it imports react or react-dom, carries the
 *   `@jsxImportSource react` pragma, matches the `react` option, or calls a
 *   hook (`useX()`, or `lib.useX()` on a namespace or default import) it
 *   imports from React (a React package or a React file).
 *   Its JSX becomes what-react createElement calls, so it runs with React's
 *   rules. A JSX tag in it that is a native component becomes a native
 *   wrapper, so that component still runs once and keeps its state.
 * - A native file: everything else. what-compiler compiles its JSX. A JSX
 *   element whose tag comes from React (a package that depends on react, or a
 *   React file, also through re-exports) becomes a React island with its
 *   whole subtree; the rest of the file is left to what-compiler untouched.
 *
 * Nothing changes in a native file that uses no React component.
 */

import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const MIXED_MODULE = 'what-react/mixed';
// what-compiler leaves a module carrying this alone: its JSX is already lowered.
export const REACT_SOURCE_MARKER = '/* what-react: react source */';

const REACT_SOURCES = new Set(['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime']);
const SCRIPT_RE = /\.[cm]?[jt]sx?$/;
const HOOK_RE = /^use[A-Z0-9]/;
const PRAGMA_RE = /@jsxImportSource\s+(\S+)/;

function loadBabel(root) {
  const attempts = [path.join(root, 'package.json'), import.meta.url];
  for (const from of attempts) {
    try {
      const require = createRequire(from);
      return require('@babel/core');
    } catch { /* try the next */ }
    try {
      // what-compiler depends on @babel/core; under a strict layout it is
      // reachable from the compiler only.
      const require = createRequire(from);
      return createRequire(require.resolve('what-compiler'))('@babel/core');
    } catch { /* try the next */ }
  }
  throw new Error('[what-react] Mixed JSX needs @babel/core, which what-compiler installs. Install what-compiler (or @babel/core) in this project.');
}

function parserPlugins(file) {
  return /\.[cm]?tsx?$/.test(file) ? ['jsx', 'typescript'] : ['jsx'];
}

function matches(pattern, value) {
  if (!pattern) return false;
  if (Array.isArray(pattern)) return pattern.some((p) => matches(p, value));
  if (pattern instanceof RegExp) { pattern.lastIndex = 0; return pattern.test(value); }
  if (typeof pattern === 'function') return !!pattern(value);
  if (typeof pattern === 'string') return value.startsWith(pattern);
  return false;
}

function isBare(source) {
  return !source.startsWith('.') && !source.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(source) && !source.startsWith('\0');
}

function packageNameOf(source) {
  const parts = source.split('/');
  return source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The nearest package.json above `file` that names a package. */
function packageJsonAbove(file) {
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') return null;
    const f = path.join(dir, 'package.json');
    if (fs.existsSync(f)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (pkg.name) return pkg;
      } catch { /* unreadable: keep looking */ }
    }
  }
  return null;
}

/** A package's package.json, looked up the way Node finds `name` from `fromDir`. */
function packageJsonByName(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const f = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(f)) {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
    }
    if (dir === path.dirname(dir)) return null;
  }
}

/** Whether a package is React code: react itself, or a package that depends on it. */
export function isReactPackage(pkg) {
  if (!pkg || !pkg.name) return false;
  if (pkg.name === 'react' || pkg.name === 'react-dom') return true;
  if (pkg.name === 'what-react') return false;
  const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
  return 'react' in deps || 'react-dom' in deps;
}

/**
 * Decides which JSX tags are React components. `resolve(source, importer)`
 * resolves an import to a file path (Vite's resolver), or null.
 */
export function createClassifier({ babel, root, react: reactOption, resolve, isOptimized = (id) => id.includes('/node_modules/.vite/') }) {
  const t = babel.types;
  /** @type {Map<string, { mtime: number, ast: any, code: string }>} */
  const parsed = new Map();
  /** @type {Map<string, Promise<boolean>>} */
  const fileKinds = new Map();
  /** @type {Map<string, Promise<boolean>>} */
  const exportKinds = new Map();
  /** @type {Map<string, boolean>} */
  const packageKinds = new Map();

  function parseFile(file, code) {
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { /* virtual */ }
    const hit = parsed.get(file);
    if (hit && hit.mtime === mtime && (code === undefined || hit.code === code)) return hit.ast;
    if (code === undefined) {
      try { code = fs.readFileSync(file, 'utf8'); } catch { return null; }
    }
    let ast;
    try {
      ast = babel.parseSync(code, {
        filename: file, configFile: false, babelrc: false, sourceType: 'module',
        parserOpts: { plugins: parserPlugins(file) },
      });
    } catch {
      ast = null; // what-compiler reports the syntax error
    }
    parsed.set(file, { mtime, ast, code });
    return ast;
  }

  /** @type {WeakMap<object, { imports: Map<string, { source: string, name: string }>, decls: Map<string, any> }>} */
  const infos = new WeakMap();
  // A file's module-level bindings: what it imports, and what it declares.
  function infoOf(ast) {
    let info = infos.get(ast);
    if (info !== undefined) return info;
    const imports = new Map();
    const decls = new Map();
    for (const node of ast.program.body) {
      if (t.isImportDeclaration(node)) {
        if (node.importKind === 'type') continue;
        for (const s of node.specifiers) {
          if (s.importKind === 'type') continue;
          if (t.isImportSpecifier(s)) imports.set(s.local.name, { source: node.source.value, name: s.imported.name ?? s.imported.value });
          else if (t.isImportDefaultSpecifier(s)) imports.set(s.local.name, { source: node.source.value, name: 'default' });
          else if (t.isImportNamespaceSpecifier(s)) imports.set(s.local.name, { source: node.source.value, name: '*' });
        }
        continue;
      }
      const decl = t.isExportNamedDeclaration(node) || t.isExportDefaultDeclaration(node) ? node.declaration : node;
      if (t.isFunctionDeclaration(decl) && decl.id) decls.set(decl.id.name, decl);
      else if (t.isVariableDeclaration(decl)) {
        for (const d of decl.declarations) if (t.isIdentifier(d.id)) decls.set(d.id.name, d.init);
      }
    }
    info = { imports, decls };
    infos.set(ast, info);
    return info;
  }

  // The `use*` functions `node` calls by name.
  function hookCalls(node) {
    const names = new Set();
    t.traverseFast(node, (n) => {
      if (t.isCallExpression(n) && t.isIdentifier(n.callee) && HOOK_RE.test(n.callee.name)) names.add(n.callee.name);
    });
    return names;
  }

  // The `use*` functions `node` calls as a member of a variable
  // (`rhf.useForm()`, `Form.useForm()`): [variable, hook name] pairs.
  function memberHookCalls(node) {
    /** @type {Map<string, [string, string]>} */
    const calls = new Map();
    t.traverseFast(node, (n) => {
      if (!t.isCallExpression(n) || !t.isMemberExpression(n.callee) || n.callee.computed) return;
      const { object, property } = n.callee;
      if (t.isIdentifier(object) && t.isIdentifier(property) && HOOK_RE.test(property.name)) calls.set(object.name + '.' + property.name, [object.name, property.name]);
    });
    return [...calls.values()];
  }

  // Whether `object.name()` calls a React hook: `object` is a namespace
  // import (the hook is its export `name`) or a default import (an object
  // of React code) of the file.
  function memberHookIsReact(file, ast, object, name, seen) {
    const imp = infoOf(ast).imports.get(object);
    if (!imp) return false;
    return importIsReact(imp.source, file, imp.name === '*' ? name : imp.name, seen);
  }

  // The identifier a call's callee starts from (`create(...)`, `zustand.create(...)`).
  function calleeRoot(callee) {
    while (t.isMemberExpression(callee)) callee = callee.object;
    return t.isIdentifier(callee) ? callee.name : null;
  }

  /**
   * Whether the hook `name` (a module-level binding of `file`) is React's: one
   * imported from React code, one a React package builds (`const useStore =
   * create(...)` with zustand's create), or a custom hook that calls one.
   */
  async function hookIsReact(file, ast, name, seen) {
    const key = file + '#hook:' + name;
    if (seen.has(key)) return false;
    seen = new Set(seen).add(key);
    const { imports, decls } = infoOf(ast);
    const imp = imports.get(name);
    if (imp) return importIsReact(imp.source, file, imp.name, seen);
    if (!decls.has(name)) return false;
    const decl = decls.get(name);
    if (t.isCallExpression(decl)) {
      const root = calleeRoot(decl.callee);
      const from = root !== null ? imports.get(root) : undefined;
      if (from && !HOOK_RE.test(root) && await importIsReact(from.source, file, from.name, seen)) return true;
    }
    const body = t.isFunctionDeclaration(decl) || t.isArrowFunctionExpression(decl) || t.isFunctionExpression(decl) ? decl
      : t.isCallExpression(decl) ? decl : null;
    if (body === null) return false;
    for (const called of hookCalls(body)) {
      if (called !== name && await hookIsReact(file, ast, called, seen)) return true;
    }
    for (const [object, called] of memberHookCalls(body)) {
      if (await memberHookIsReact(file, ast, object, called, seen)) return true;
    }
    return false;
  }

  function invalidate(file) {
    parsed.delete(file);
    // What another file decided through this one can change too.
    fileKinds.clear();
    exportKinds.clear();
  }

  function packageIsReact(resolved, source, importer) {
    /** @type {{ name?: string, [field: string]: unknown } | null} */
    let pkg = null;
    if (resolved && resolved.includes('/node_modules/') && !isOptimized(resolved)) pkg = packageJsonAbove(resolved);
    if (!pkg && isBare(source)) pkg = packageJsonByName(packageNameOf(source), path.dirname(importer));
    // A package.json with no name is not a React package (isReactPackage).
    if (!pkg || !pkg.name) return false;
    let kind = packageKinds.get(pkg.name);
    if (kind === undefined) {
      kind = isReactPackage(pkg);
      packageKinds.set(pkg.name, kind);
    }
    return kind;
  }

  /** Whether `name`, imported from `source` by `importer`, is React code. */
  async function importIsReact(source, importer, name, seen) {
    if (REACT_SOURCES.has(source)) return true;
    let resolved;
    try { resolved = await resolve(source, importer); } catch { resolved = null; }
    if (resolved) resolved = resolved.split('?')[0];
    if (!resolved || resolved.includes('/node_modules/') || isOptimized(resolved) || !path.isAbsolute(resolved)) {
      return isBare(source) || (resolved && (resolved.includes('/node_modules/') || isOptimized(resolved))) ? packageIsReact(resolved, source, importer) : false;
    }
    return exportIsReact(resolved, name, seen);
  }

  /** Whether `file` is a React file (all its JSX follows React's rules). */
  function fileIsReact(file, code, seen = new Set()) {
    const key = file;
    // Asked again while deciding it (an import cycle): not React from here.
    if (seen.has(file)) return Promise.resolve(false);
    if (code === undefined && fileKinds.has(key)) return fileKinds.get(key);
    const result = decideFile(file, code, seen);
    if (code === undefined) fileKinds.set(key, result);
    return result;
  }

  async function decideFile(file, code, seen) {
    if (!SCRIPT_RE.test(file)) return false;
    seen = new Set(seen).add(file);
    const ast = parseFile(file, code);
    if (!ast) return false;
    const pragma = pragmaOf(ast);
    if (pragma === 'react') return true;
    if (pragma !== null) return false;
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (matches(reactOption, rel)) return true;
    for (const node of ast.program.body) {
      if (!t.isImportDeclaration(node) || node.importKind === 'type') continue;
      const values = node.specifiers.filter((s) => s.importKind !== 'type');
      if (REACT_SOURCES.has(node.source.value) && (values.length > 0 || node.specifiers.length === 0)) return true;
    }
    // A file that calls a React hook is React code.
    const { imports, decls } = infoOf(ast);
    for (const called of hookCalls(ast.program)) {
      if (!imports.has(called) && !decls.has(called)) continue;
      if (await hookIsReact(file, ast, called, seen)) return true;
    }
    for (const [object, called] of memberHookCalls(ast.program)) {
      if (await memberHookIsReact(file, ast, object, called, seen)) return true;
    }
    return false;
  }

  function exportIsReact(file, name, seen = new Set()) {
    const key = file + '\0' + name;
    if (seen.has(file + '#' + name)) return Promise.resolve(false);
    if (exportKinds.has(key)) return exportKinds.get(key);
    const result = decideExport(file, name, seen);
    exportKinds.set(key, result);
    return result;
  }

  async function decideExport(file, name, seen) {
    if (!SCRIPT_RE.test(file)) return false;
    // A component a React file declares itself is React; a name it
    // re-exports is whatever it is where it comes from.
    const reactFile = await fileIsReact(file, undefined, seen);
    if (name === '*') return reactFile;
    seen = new Set(seen).add(file + '#' + name);
    const ast = parseFile(file);
    if (!ast) return false;
    const { imports } = infoOf(ast);
    const local = async (binding) => {
      const imp = imports.get(binding);
      if (imp) return importIsReact(imp.source, file, imp.name, seen);
      return reactFile || (HOOK_RE.test(binding) && hookIsReact(file, ast, binding, seen));
    };
    const declares = (decl) => {
      if (!decl) return false;
      if (t.isFunctionDeclaration(decl) || t.isClassDeclaration(decl)) return decl.id?.name === name;
      if (t.isVariableDeclaration(decl)) return decl.declarations.some((d) => t.isIdentifier(d.id, { name }));
      return false;
    };
    const stars = [];
    for (const node of ast.program.body) {
      if (t.isExportNamedDeclaration(node) && node.exportKind !== 'type') {
        if (declares(node.declaration)) return reactFile || (HOOK_RE.test(name) && hookIsReact(file, ast, name, seen));
        for (const s of node.specifiers) {
          const exported = s.exported.name ?? s.exported.value;
          if (exported !== name) continue;
          if (node.source) {
            const from = t.isExportNamespaceSpecifier(s) ? '*' : (s.local.name ?? s.local.value);
            return importIsReact(node.source.value, file, from, seen);
          }
          return local(s.local.name);
        }
      } else if (t.isExportDefaultDeclaration(node) && name === 'default') {
        return t.isIdentifier(node.declaration) ? local(node.declaration.name) : reactFile;
      } else if (t.isExportAllDeclaration(node) && node.exportKind !== 'type') {
        if (node.exported) {
          if ((node.exported.name ?? node.exported.value) === name) return importIsReact(node.source.value, file, '*', seen);
        } else {
          stars.push(node.source.value);
        }
      }
    }
    for (const source of stars) {
      if (await importIsReact(source, file, name, seen)) return true;
    }
    return false;
  }

  function pragmaOf(ast) {
    for (const c of ast.comments || []) {
      const m = PRAGMA_RE.exec(c.value);
      if (m) return m[1];
    }
    return null;
  }

  /**
   * The facts a file's kind and its exports' kinds rest on, as a string: a
   * change to them (in development) means files that import it may compile
   * differently.
   */
  function signature(file, code) {
    const ast = parseFile(file, code);
    if (!ast) return '';
    const parts = [pragmaOf(ast) ?? ''];
    // The imports a hook is called on as a member (`rhf.useForm()`).
    const hookObjects = new Set(memberHookCalls(ast.program).map(([object]) => object));
    for (const node of ast.program.body) {
      if (t.isImportDeclaration(node)) {
        parts.push('i:' + node.source.value + ':' + node.specifiers.map((s) => s.local.name).filter((n) => HOOK_RE.test(n) || hookObjects.has(n) || REACT_SOURCES.has(node.source.value)).join(','));
      } else if ((t.isExportNamedDeclaration(node) && (node.source || node.specifiers.length > 0)) || t.isExportAllDeclaration(node)) {
        parts.push('e:' + (node.source ? node.source.value : '') + ':' + (node.specifiers || []).map((s) => s.exported.name ?? s.exported.value).join(','));
      }
    }
    return parts.join('|');
  }

  return { parseFile, fileIsReact, importIsReact, exportIsReact, invalidate, signature };
}

// =====================================================================
// Transform
// =====================================================================

/**
 * Lower the JSX of `ast`. `reactFile`: every element becomes a createElement
 * call. Otherwise only elements whose tag is in `reactTags` (local names of
 * React components) become islands, with their subtrees.
 * Returns whether anything changed.
 */
export function lowerJsx(babel, ast, { reactFile, reactTags, nativeTags }) {
  const t = babel.types;
  const program = ast.program;
  // The Program's path: the traversal below always visits it, synchronously.
  /** @type {{ scope: { generateUidIdentifier(name: string): unknown, hasBinding(name: string): boolean, hasGlobal(name: string): boolean, references: Record<string, boolean> } }} */
  let programPath;
  babel.traverse(ast, { Program(p) { programPath = p; p.stop(); } });
  const uid = (name) => programPath.scope.generateUidIdentifier(name);
  // A JSX tag what-compiler reads as a component starts with a capital.
  const componentUid = (name) => {
    let n = name;
    for (let i = 2; programPath.scope.hasBinding(n) || programPath.scope.hasGlobal(n); i++) n = name + i;
    programPath.scope.references[n] = true;
    return t.identifier(n);
  };
  const ids = {};
  const id = (name) => (ids[name] ??= name === 'ReactIsland' ? componentUid('WhatReactIsland') : uid(name));
  const natives = new Map();

  const rootName = (n) => (t.isJSXMemberExpression(n) ? rootName(n.object) : t.isJSXIdentifier(n) ? n.name : null);
  // `member`: the name starts a member expression (<motion.div>,
  // <table.FlexRender>), where it is a variable whatever its case.
  const tagOf = (n, member = false) => {
    if (t.isJSXNamespacedName(n)) return t.stringLiteral(`${n.namespace.name}:${n.name.name}`);
    if (t.isJSXMemberExpression(n)) return t.memberExpression(tagOf(n.object, true), t.identifier(n.property.name));
    if (n.name === 'this') return t.thisExpression();
    return !member && t.react.isCompatTag(n.name) ? t.stringLiteral(n.name) : t.identifier(n.name);
  };

  // A component tag inside React code. In a React file: a native component
  // imported from native code is wrapped; React components and the file's own
  // components are React. In a native file's island: React tags stay, every
  // other component is native and is wrapped.
  const componentTag = (opening, path) => {
    const tag = tagOf(opening.name);
    if (t.isStringLiteral(tag) || t.isThisExpression(tag)) return tag;
    const name = rootName(opening.name);
    if (reactFile) {
      if (!nativeTags.has(name)) return tag;
      // A React file reads the import when the element renders (nativeRef).
      const key = generateKey(opening.name);
      let alias = natives.get(key);
      if (alias === undefined) {
        alias = uid('n$' + key.replace(/\W/g, '_'));
        natives.set(key, alias);
        nativeDecls.push(t.variableDeclaration('const', [t.variableDeclarator(alias,
          t.callExpression(id('nativeRef'), [t.arrowFunctionExpression([], tagOf(opening.name)), t.stringLiteral(key)]))]));
      }
      return t.identifier(alias.name);
    }
    if (reactTags.has(name)) return tag;
    const binding = path.scope.getBinding(name);
    if (!binding && !nativeTags.has(name)) return tag;
    return t.callExpression(id('native'), [tag]);
  };
  const generateKey = (n) => (t.isJSXMemberExpression(n) ? generateKey(n.object) + '.' + n.property.name : n.name);
  const nativeDecls = [];

  const attrKey = (name) => (t.isJSXNamespacedName(name) ? `${name.namespace.name}:${name.name.name}` : name.name);
  const attrValue = (value) => {
    if (value == null) return t.booleanLiteral(true);
    if (t.isJSXExpressionContainer(value)) return t.isJSXEmptyExpression(value.expression) ? t.identifier('undefined') : value.expression;
    if (t.isStringLiteral(value)) {
      // JSX attribute strings keep their characters; only line breaks with
      // indentation collapse to one space, as React's JSX transform does.
      return t.stringLiteral(value.value.replace(/\s*\n\s*/g, ' '));
    }
    return value; // an element, lowered already
  };

  const toCall = (node, path) => {
    if (t.isJSXFragment(node)) {
      return t.callExpression(id('createElement'), [id('Fragment'), t.nullLiteral(), ...t.react.buildChildren(node)]);
    }
    const opening = node.openingElement;
    const props = opening.attributes.map((a) => (t.isJSXSpreadAttribute(a)
      ? t.spreadElement(a.argument)
      : t.objectProperty(t.stringLiteral(attrKey(a.name)), attrValue(a.value))));
    const args = [componentTag(opening, path), props.length > 0 ? t.objectExpression(props) : t.nullLiteral(), ...t.react.buildChildren(node)];
    return t.callExpression(id('createElement'), args);
  };

  // Lower every element of `root`'s subtree to a createElement call, inside
  // out, returning the call for `root`.
  const lowerTree = (rootPath) => {
    const replace = (p) => {
      const call = toCall(p.node, p);
      if (p === rootPath) return;
      p.replaceWith(t.isJSXElement(p.parent) || t.isJSXFragment(p.parent) ? t.jsxExpressionContainer(call) : call);
    };
    rootPath.traverse({ JSXElement: { exit: replace }, JSXFragment: { exit: replace } });
    return toCall(rootPath.node, rootPath);
  };

  let changed = false;
  if (reactFile) {
    babel.traverse(ast, {
      'JSXElement|JSXFragment'(p) {
        const call = lowerTree(p);
        p.replaceWith(t.isJSXElement(p.parent) || t.isJSXFragment(p.parent) ? t.jsxExpressionContainer(call) : call);
        p.skip();
        changed = true;
      },
    });
  } else {
    babel.traverse(ast, {
      JSXElement(p) {
        const tagNode = p.node.openingElement.name;
        // A bare lowercase tag is a host element, whatever variable shares its name.
        if (t.isJSXIdentifier(tagNode) && t.react.isCompatTag(tagNode.name)) return;
        const name = rootName(tagNode);
        if (name === null || !reactTags.has(name) || p.scope.hasBinding(name) && p.scope.getBinding(name).kind !== 'module') return;
        const svg = p.findParent((q) => q.isJSXElement() && t.isJSXIdentifier(q.node.openingElement.name, { name: 'svg' })) !== null;
        // A row of a native .map() list keeps its key, so what-compiler keeps
        // the row (and the React state in it) by key.
        const keyAttr = p.node.openingElement.attributes.find((a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name, { name: 'key' }));
        const call = lowerTree(p);
        const attrs = [t.jsxAttribute(t.jsxIdentifier('view'), t.jsxExpressionContainer(t.arrowFunctionExpression([], call)))];
        if (keyAttr) attrs.unshift(t.jsxAttribute(t.jsxIdentifier('key'), t.cloneNode(keyAttr.value, true)));
        if (svg) attrs.push(t.jsxAttribute(t.jsxIdentifier('svg')));
        const island = t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier(id('ReactIsland').name), attrs, true), null, [], true);
        // Where the React tag was written: what-compiler's development
        // location for the island names it.
        island.loc = p.node.loc;
        island.openingElement.loc = p.node.openingElement.loc;
        p.replaceWith(island);
        p.skip();
        changed = true;
      },
    });
  }
  if (!changed) return false;

  const specifiers = Object.entries(ids).map(([name, local]) => t.importSpecifier(local, t.identifier(name)));
  program.body.unshift(t.importDeclaration(specifiers, t.stringLiteral(MIXED_MODULE)));
  // After the imports: each alias reads its import only when it renders.
  let at = 0;
  while (at < program.body.length && t.isImportDeclaration(program.body[at])) at++;
  program.body.splice(at, 0, ...nativeDecls);
  return true;
}

/**
 * The file a dependency Vite pre-bundled in development (node_modules/.vite)
 * was built from, so the package it belongs to can be read.
 */
function optimizedSource(ctx, id) {
  const file = id.split('?')[0];
  const optimizer = ctx.environment?.depsOptimizer ?? null;
  const meta = optimizer?.metadata;
  if (!meta) return null;
  for (const group of [meta.optimized, meta.discovered, meta.chunks]) {
    if (!group) continue;
    for (const dep of Object.values(group)) {
      if (dep && dep.file === file && dep.src) return dep.src;
    }
  }
  return null;
}

/**
 * The Vite plugin. `react`: files (paths relative to the root: a prefix
 * string, a RegExp, a function, or a list of them) that are React files
 * whatever they import.
 */
export function mixedJsx(options = {}) {
  const include = options.include ?? /\.[jt]sx$/;
  /** @type {ReturnType<typeof loadBabel> | null} */
  let babel = null;
  let root = process.cwd();
  /** @type {ReturnType<typeof createClassifier> | null} */
  let classifier = null;
  /** @type {((source: string, importer: string) => Promise<string | null>) | null} */
  let resolveRef = null;
  /** @type {string | null} */
  let cacheDir = null;
  // A module Vite pre-bundled (its dependency cache, node_modules/.vite by default).
  const isOptimized = (id) => (cacheDir !== null && id.startsWith(cacheDir)) || id.includes('/node_modules/.vite/');
  const signatures = new Map();

  const ensure = () => {
    if (babel === null) babel = loadBabel(root);
    if (classifier === null) {
      classifier = createClassifier({ babel, root, react: options.react, resolve: (s, i) => (resolveRef === null ? null : resolveRef(s, i)), isOptimized });
    }
    return classifier;
  };

  return {
    name: 'what-react-mixed-jsx',
    enforce: /** @type {const} */ ('pre'),

    configResolved(config) {
      root = config.root;
      if (config.cacheDir) cacheDir = path.resolve(config.root, config.cacheDir) + path.sep;
    },

    async transform(code, id) {
      if (id.startsWith('\0') || id.includes('/node_modules/')) return null;
      const file = id.split('?')[0];
      if (!matches(include, file)) return null;
      const c = ensure();
      const ctx = this;
      resolveRef = async (source, importer) => {
        const r = await ctx.resolve(source, importer, { skipSelf: true });
        if (!r || r.external) return null;
        if (!isOptimized(r.id)) return r.id;
        // A dependency Vite pre-bundles in development resolves to its bundle;
        // the package it comes from is what decides. Resolve as Vite's own
        // dependency scan does, which never answers with a bundle.
        const known = optimizedSource(ctx, r.id);
        if (known) return known;
        const scanned = await ctx.resolve(source, importer, { skipSelf: true, scan: true }).catch(() => null);
        return scanned && !scanned.external && !isOptimized(scanned.id) ? scanned.id : r.id;
      };
      const ast = c.parseFile(file, code);
      if (!ast) return null; // what-compiler reports the syntax error
      signatures.set(file, c.signature(file, code));
      const t = babel.types;

      const reactFile = await c.fileIsReact(file, code);
      const reactTags = new Set();
      const nativeTags = new Set();
      const tagNames = new Set();
      babel.traverse(ast, {
        JSXOpeningElement(p) {
          let n = p.node.name;
          // The object of a member tag is a variable, lowercase or not
          // (<motion.div>): only a bare lowercase name is a host element.
          const member = t.isJSXMemberExpression(n);
          while (t.isJSXMemberExpression(n)) n = n.object;
          if (t.isJSXIdentifier(n) && n.name !== 'this' && (member || !t.react.isCompatTag(n.name))) tagNames.add(n.name);
        },
      });
      if (!reactFile && tagNames.size === 0) return null;
      if (reactFile && !/<[A-Za-z>]/.test(code)) return { code: code + '\n' + REACT_SOURCE_MARKER, map: null };
      for (const node of ast.program.body) {
        if (!t.isImportDeclaration(node) || node.importKind === 'type') continue;
        for (const s of node.specifiers) {
          if (s.importKind === 'type' || !tagNames.has(s.local.name)) continue;
          const imported = t.isImportSpecifier(s) ? (s.imported.name ?? s.imported.value) : t.isImportDefaultSpecifier(s) ? 'default' : '*';
          const isReact = imported === '*'
            ? await c.importIsReact(node.source.value, file, '*', new Set())
            : await c.importIsReact(node.source.value, file, imported, new Set());
          (isReact ? reactTags : nativeTags).add(s.local.name);
        }
      }
      if (!reactFile && reactTags.size === 0) return null;

      // The classifier's parse is shared (another environment's transform of
      // this file reads it too): lower a parse of this transform's own.
      const own = babel.parseSync(code, {
        filename: file, configFile: false, babelrc: false, sourceType: 'module',
        parserOpts: { plugins: parserPlugins(file) },
      });
      lowerJsx(babel, own, { reactFile, reactTags, nativeTags });
      // retainLines: each statement stays on its source line, so what-compiler's
      // development locations (diagnostics, devtools) name the line you wrote.
      const out = babel.transformFromAstSync(own, code, {
        filename: id, configFile: false, babelrc: false, sourceMaps: true, cloneInputAst: false, retainLines: true,
        parserOpts: { plugins: parserPlugins(file) },
      });
      return { code: reactFile ? out.code + '\n' + REACT_SOURCE_MARKER : out.code, map: out.map };
    },

    handleHotUpdate({ file, server }) {
      if (!signatures.has(file) || classifier === null) return;
      let code;
      try { code = fs.readFileSync(file, 'utf8'); } catch { return; }
      classifier.invalidate(file);
      const next = classifier.signature(file, code);
      if (next !== signatures.get(file)) {
        // Which tags are React components may have changed in the files that
        // import this one: start over.
        signatures.set(file, next);
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}
