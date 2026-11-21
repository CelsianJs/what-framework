// The checks that need no running program: parse, strip TypeScript, compile with
// what-compiler, resolve imports against the real exports, find free
// identifiers, and lint with eslint-plugin-what.

import { createHash } from 'node:crypto';
import { transformSync as esbuildTransform } from 'esbuild';
import { parse } from '@babel/parser';
import { transformSync, traverse } from '@babel/core';
import { Linter } from 'eslint';
import babelPlugin from '../../../packages/compiler/src/babel-plugin.js';
import eslintPlugin from '../../../packages/eslint-plugin/src/index.js';

const CODE_RE = /\bERR_[A-Z0-9_]+\b/g;

/** Error codes named in a text, in order, without repeats. */
export function codesIn(text) {
  return [...new Set(String(text ?? '').match(CODE_RE) || [])];
}

function parserPlugins(lang) {
  if (lang === 'ts') return ['typescript'];
  if (lang === 'tsx') return ['typescript', 'jsx'];
  return ['jsx'];
}

/**
 * Parse a snippet as a module in its language. When it does not parse, the
 * AST Babel's error recovery could build (if any) comes back as `recovered`,
 * so the imports of a broken snippet are still checked.
 * @returns {{ ast: object } | { error: string, line: number | null, recovered: object | null }}
 */
export function parseSnippet(code, lang) {
  const options = { sourceType: 'module', plugins: parserPlugins(lang) };
  try {
    return { ast: parse(code, options) };
  } catch (err) {
    let recovered = null;
    try { recovered = parse(code, { ...options, errorRecovery: true }); } catch { /* not recoverable: imports go unchecked until it parses */ }
    return { error: err.message.replace(/\s*\(\d+:\d+\)$/, ''), line: err.loc?.line ?? null, recovered };
  }
}

/**
 * TypeScript to JavaScript with esbuild's ts/tsx loader. Imports written as
 * values are kept even when unused, so the import check and the bundle see
 * what the snippet wrote; `import type` and inline `type` specifiers go.
 */
export function stripTypes(code, lang) {
  if (lang !== 'ts' && lang !== 'tsx') return { code };
  try {
    const out = esbuildTransform(code, {
      loader: lang,
      jsx: 'preserve',
      format: 'esm',
      target: 'esnext',
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
      logLevel: 'silent',
    });
    return { code: out.code };
  } catch (err) {
    const first = err.errors?.[0];
    return { error: first ? first.text : err.message, line: first?.location?.line ?? null };
  }
}

const BAD_COMMENT_RE = /^\s*(?:bad\b|wrong\b|incorrect\b|anti-pattern\b|❌|✗|✘)/i;

/** True when one of the snippet's comments starts by calling the code bad. */
export function hasBadComment(code, ast) {
  if (ast) return ast.comments.some((c) => BAD_COMMENT_RE.test(c.value.replace(/^\*+/, '')));
  return /(?:^|[^:])(?:\/\/|\/\*+)\s*(?:bad\b|wrong\b|incorrect\b|anti-pattern\b|❌|✗|✘)/im.test(code);
}

/**
 * Every module request of a snippet (imports, re-exports, literal dynamic
 * imports), with the names it takes and whether each is type-only.
 * @returns {{ source: string, line: number, names: { imported: string, type: boolean }[] }[]}
 */
export function importsOf(ast) {
  const out = [];
  const nameOf = (node) => (node.type === 'StringLiteral' ? node.value : node.name);
  for (const node of ast.program.body) {
    const line = node.loc?.start.line ?? 1;
    if (node.type === 'ImportDeclaration') {
      const typeOnly = node.importKind === 'type' || node.importKind === 'typeof';
      const names = node.specifiers
        .filter((s) => s.type !== 'ImportNamespaceSpecifier')
        .map((s) => ({
          imported: s.type === 'ImportDefaultSpecifier' ? 'default' : nameOf(s.imported),
          type: typeOnly || s.importKind === 'type' || s.importKind === 'typeof',
        }));
      out.push({ source: node.source.value, line, names });
    } else if ((node.type === 'ExportNamedDeclaration' && node.source) || node.type === 'ExportAllDeclaration') {
      const typeOnly = node.exportKind === 'type';
      const names = (node.specifiers || [])
        .filter((s) => s.type === 'ExportSpecifier')
        .map((s) => ({ imported: nameOf(s.local), type: typeOnly || s.exportKind === 'type' }));
      out.push({ source: node.source.value, line, names });
    }
  }
  traverse(ast, {
    noScope: true,
    CallExpression(path) {
      const { node } = path;
      if (node.callee.type === 'Import' && node.arguments[0]?.type === 'StringLiteral') {
        out.push({ source: node.arguments[0].value, line: node.loc?.start.line ?? 1, names: [] });
      }
    },
  });
  return out;
}

/**
 * Check a snippet's imports of What packages against what those packages
 * export. Imports of anything else are listed but not judged.
 * @param {import('./exports.mjs').Exports} exportsIndex
 * @returns {{ problems: { line: number, message: string }[], checked: number, unchecked: string[], external: string[], ours: object[] }}
 */
export function checkImports(ast, exportsIndex) {
  const problems = [];
  const unchecked = [];
  const external = [];
  const ours = [];
  let checked = 0;
  for (const imp of importsOf(ast)) {
    if (!exportsIndex.isOurs(imp.source)) {
      external.push(imp.source);
      continue;
    }
    const resolved = exportsIndex.resolve(imp.source);
    if (resolved.error) {
      problems.push({ line: imp.line, message: `imports from '${imp.source}': ${resolved.error}` });
      continue;
    }
    ours.push({ ...imp, pkg: resolved.pkg });
    checked++;
    const values = imp.names.filter((n) => !n.type);
    const types = imp.names.filter((n) => n.type);
    if (values.length) {
      const available = exportsIndex.valueExports(imp.source);
      for (const { imported } of values) {
        if (available.names.has(imported)) continue;
        if (available.open) {
          unchecked.push(`${imported} from '${imp.source}' (exports could not all be read)`);
          continue;
        }
        problems.push({
          line: imp.line,
          message: imported === 'default'
            ? `imports a default export from '${imp.source}', which has none`
            : `imports ${imported} from '${imp.source}', which does not export it`,
        });
      }
    }
    if (types.length) {
      const available = exportsIndex.typeExports(imp.source);
      for (const { imported } of types) {
        if (available.names.has(imported)) continue;
        if (available.open) {
          unchecked.push(`type ${imported} from '${imp.source}' (no readable declarations)`);
          continue;
        }
        problems.push({ line: imp.line, message: `imports type ${imported} from '${imp.source}', which its declarations do not export` });
      }
    }
  }
  return { problems, checked, unchecked, external, ours };
}

let compileCounter = 0;

/**
 * Compile with what-compiler's Babel plugin, development, the way
 * what-compiler/vite compiles an app in dev: the client target unless
 * `generate: 'ssr'` asks for the server target. Everything it prints is
 * returned as `warnings`; the ones that carry an ERR_* code are the reports.
 * @param {string} code
 * @param {{ generate?: 'dom' | 'ssr' }} [options]
 * @returns {{ code: string, warnings: string[] } | { error: string, codes: string[], line: number | null, warnings: string[] }}
 */
export function compileSnippet(code, { generate = 'dom' } = {}) {
  const filename = `snippet-${createHash('sha1').update(code).digest('hex').slice(0, 10)}-${++compileCounter}.jsx`;
  const warnings = [];
  const saved = { warn: console.warn, info: console.info, log: console.log };
  const collect = (...args) => { warnings.push(args.map(String).join(' ')); };
  Object.assign(console, { warn: collect, info: collect, log: collect });
  try {
    const result = transformSync(code, {
      filename,
      plugins: [[babelPlugin, { production: false, generate }]],
      parserOpts: { plugins: ['jsx'] },
      sourceType: 'module',
      configFile: false,
      babelrc: false,
      compact: false,
    });
    return { code: result?.code || '', warnings };
  } catch (err) {
    const message = String(err.message).replace(/^.*?snippet-[0-9a-f]+-\d+\.jsx:\s*/, '').split('\n')[0];
    return { error: message, codes: codesIn(`${err.code || ''} ${err.message}`), line: err.loc?.line ?? null, warnings };
  } finally {
    Object.assign(console, saved);
  }
}

/** The ERR_* codes among compile warnings. */
export function codedWarnings(warnings) {
  return warnings.filter((w) => codesIn(w).length > 0);
}

/**
 * Identifiers the compiled module reads or writes without declaring them,
 * minus the globals the run environment provides.
 */
export function freeIdentifiers(compiledCode, environmentGlobals) {
  const ast = parse(compiledCode, { sourceType: 'module' });
  let globals = [];
  traverse(ast, {
    Program(path) {
      globals = Object.keys(path.scope.globals);
      path.stop();
    },
  });
  return globals.filter((name) => !environmentGlobals.has(name));
}

/** Top-level component candidates: PascalCase functions, and which of them others render. */
export function componentCandidates(compiledCode) {
  const ast = parse(compiledCode, { sourceType: 'module' });
  const candidates = [];
  let defaultExport = null;
  const isPascal = (name) => /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);
  const fnInfo = (fn) => ({ params: fn.params.length });
  for (const node of ast.program.body) {
    const decl = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration' ? node.declaration : node;
    if (!decl) continue;
    if (node.type === 'ExportDefaultDeclaration') {
      if (decl.type === 'FunctionDeclaration' || decl.type === 'ArrowFunctionExpression' || decl.type === 'FunctionExpression') {
        defaultExport = { name: decl.id?.name ?? null, ...fnInfo(decl), node: decl };
      } else if (decl.type === 'Identifier') {
        defaultExport = { name: decl.name, ref: true };
      }
    }
    if (decl.type === 'FunctionDeclaration' && decl.id && isPascal(decl.id.name)) {
      candidates.push({ name: decl.id.name, ...fnInfo(decl), node: decl });
    } else if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.id.type === 'Identifier' && isPascal(d.id.name) && d.init && (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression')) {
          candidates.push({ name: d.id.name, ...fnInfo(d.init), node: d.init });
        }
      }
    }
  }
  if (defaultExport?.ref) {
    const target = candidates.find((c) => c.name === defaultExport.name);
    defaultExport = target ? { ...target } : null;
  }
  const referenced = new Set();
  for (const c of candidates) {
    traverse(c.node, {
      noScope: true,
      Identifier(path) {
        if (path.node.name !== c.name && candidates.some((o) => o.name === path.node.name)) referenced.add(path.node.name);
      },
    }, null, {});
  }
  return {
    defaultExport: defaultExport && { name: defaultExport.name, params: defaultExport.params },
    candidates: candidates.map((c) => ({ name: c.name, params: c.params, root: !referenced.has(c.name) })),
  };
}

/** True when the module calls an imported What `mount` or `hydrate` itself. */
export function mountsItself(ast) {
  const mounters = new Set();
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration' || !/^what-(?:framework|core)(?:\/|$)/.test(node.source.value)) continue;
    for (const s of node.specifiers) {
      if (s.type === 'ImportSpecifier' && ['mount', 'hydrate'].includes(s.imported.name ?? s.imported.value)) mounters.add(s.local.name);
    }
  }
  if (mounters.size === 0) return false;
  let found = false;
  traverse(ast, {
    CallExpression(path) {
      const { callee } = path.node;
      if (callee.type === 'Identifier' && mounters.has(callee.name) && path.scope.getBinding(callee.name)?.kind === 'module') {
        found = true;
        path.stop();
      }
    },
  });
  return found;
}

const LOOKUPS = new Set(['querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName', 'getElementsByTagName', 'getElementsByName']);

/**
 * Page elements the snippet looks up that the harness page does not have: it
 * has one `<div id="app">`. A lookup of anything else (document.querySelector('form'),
 * mount(<App />, '#root')) depends on markup the snippet does not create.
 */
export function pageLookups(ast) {
  const found = [];
  const isApp = (node, method) => node?.type === 'StringLiteral' && (method === 'getElementById' ? node.value === 'app' : node.value === '#app');
  traverse(ast, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'document' && !callee.computed && LOOKUPS.has(callee.property.name)) {
        if (!isApp(args[0], callee.property.name)) found.push(`document.${callee.property.name}(${args[0]?.type === 'StringLiteral' ? JSON.stringify(args[0].value) : '…'})`);
      } else if (callee.type === 'Identifier' && ['mount', 'hydrate'].includes(callee.name) && path.scope.getBinding(callee.name)?.kind === 'module') {
        if (args[1]?.type === 'StringLiteral' && args[1].value !== '#app') found.push(`${callee.name}(…, ${JSON.stringify(args[1].value)})`);
      }
    },
  });
  return found;
}

const linter = new Linter();
const RULE_CODES = new Map(Object.entries(eslintPlugin.rules).map(([name, rule]) => [`what/${name}`, rule.meta?.docs?.code]));

/**
 * Lint with eslint-plugin-what's recommended preset.
 * @returns {{ codes: string[], found: { code: string, line: number }[] } | { error: string }}
 */
export function lintSnippet(code) {
  const messages = linter.verify(code, [eslintPlugin.configs.recommended], { filename: 'snippet.jsx' });
  const fatal = messages.find((m) => m.fatal);
  if (fatal) return { error: fatal.message };
  const found = messages.filter((m) => RULE_CODES.get(m.ruleId)).map((m) => ({ code: RULE_CODES.get(m.ruleId), line: m.line }));
  return { codes: [...new Set(found.map((f) => f.code))], found };
}
