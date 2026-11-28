// No module of what-core does work at module scope that an app's bundler must
// keep. Every top-level statement is a declaration whose initializer esbuild,
// Rollup and Rolldown can all drop when nothing reads it. A registration, a
// listener, a global write or a call they cannot prove pure keeps its whole
// module, and what it references, in every app that reaches that module: that
// is how a compiled counter once carried the vnode renderer and a focusin
// listener. A deliberate call is marked /* @__PURE__ */, which promises the
// bundler it may drop the call when its result is unused.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return files(path);
  return entry.name.endsWith('.js') ? [path] : [];
});

// Constructors and calls all three bundlers treat as removable when unused.
const PURE_NEW = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);
const isPureAnnotated = (node) => (node.leadingComments || []).some((c) => /[@#]__PURE__/.test(c.value));
const isDevFlag = (node) => node.type === 'Identifier' && node.name === '__DEV__';
// `__DEV__` or `__DEV__ && x`: false in the production tier.
const isDevGuard = (node) => isDevFlag(node) || (node.type === 'LogicalExpression' && node.operator === '&&' && isDevFlag(node.left));

function removable(node) {
  if (!node) return true;
  if (isPureAnnotated(node)) return (node.arguments || []).every(removable);
  switch (node.type) {
    case 'NumericLiteral': case 'StringLiteral': case 'BooleanLiteral': case 'NullLiteral': case 'RegExpLiteral':
    case 'Identifier': case 'ArrowFunctionExpression': case 'FunctionExpression':
      return true;
    case 'TemplateLiteral': return node.expressions.every(removable);
    case 'UnaryExpression': return node.operator !== 'delete' && removable(node.argument);
    case 'BinaryExpression': return removable(node.left) && removable(node.right);
    // `__DEV__ && x` folds to `false` in the production tier.
    case 'LogicalExpression': return isDevGuard(node) || (removable(node.left) && removable(node.right));
    case 'ConditionalExpression':
      if (isDevGuard(node.test)) return removable(node.alternate);
      return removable(node.test) && removable(node.consequent) && removable(node.alternate);
    case 'ArrayExpression': return node.elements.every(removable);
    case 'ObjectExpression':
      return node.properties.every((p) => p.type === 'ObjectMethod' || (p.type === 'ObjectProperty' && !p.computed && removable(p.value)));
    case 'NewExpression':
      return node.callee.type === 'Identifier' && PURE_NEW.has(node.callee.name) && node.arguments.every(removable);
    case 'CallExpression': {
      const { callee } = node;
      if (callee.type === 'Identifier' && callee.name === 'Symbol') return node.arguments.every(removable);
      if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier' || callee.computed) return false;
      const name = `${callee.object.name}.${callee.property.name}`;
      if (name === 'Symbol.for') return node.arguments.every(removable);
      return name === 'Object.create' && node.arguments.length === 1 && node.arguments[0].type === 'NullLiteral';
    }
    default: return false;
  }
}

function offenders(file) {
  const source = readFileSync(file, 'utf8');
  const ast = parse(source, { sourceType: 'module', attachComment: true });
  const found = [];
  for (const statement of ast.program.body) {
    let node = statement;
    if (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') {
      if (!statement.declaration) continue;
      node = statement.declaration;
    }
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'FunctionDeclaration') continue;
    if (node.type === 'ClassDeclaration' && (!node.superClass || node.superClass.type === 'Identifier')
      && node.body.body.every((m) => !m.static || m.type === 'ClassMethod')) continue;
    if (node.type === 'VariableDeclaration' && node.declarations.every((d) => removable(d.init))) continue;
    // Development-only setup, removed entirely by the production tier.
    if (node.type === 'IfStatement' && isDevGuard(node.test)) continue;
    // env.js: the flag itself, which the production tier defines as `false`.
    if (relative(SRC, file) === 'env.js' && node.type === 'VariableDeclaration' && node.declarations[0].id.name === '__DEV__') continue;
    found.push(`${relative(SRC, file)}:${statement.loc.start.line} ${source.slice(statement.start, statement.end).split('\n')[0].slice(0, 90)}`);
  }
  return found;
}

describe('module scope', () => {
  it('no what-core module does work at module scope that a bundler must keep', () => {
    const found = files(SRC).flatMap(offenders);
    assert.deepEqual(found, [], `make these lazy, or mark a call that is safe to drop /* @__PURE__ */:\n${found.join('\n')}`);
  });

  it('flags the shapes that once leaked into every app', () => {
    const check = (code) => {
      const ast = parse(code, { sourceType: 'module', attachComment: true });
      return ast.program.body.every((s) => s.type === 'VariableDeclaration' && s.declarations.every((d) => removable(d.init)));
    };
    assert.equal(check('install(createDOM);'), false, 'a registration call');
    assert.equal(check('const s = signal(null);'), false, 'an unannotated call');
    assert.equal(check('const f = Object.freeze({});'), false, 'Object.freeze, which esbuild and Rolldown keep');
    assert.equal(check('const t = Function.prototype.toString;'), false, 'a global member read');
    assert.equal(check('const h = /* @__PURE__ */ producer(function h() {});'), true, 'an annotated definition');
    assert.equal(check('const m = new Map(); const id = Symbol("x"); const e = Object.create(null);'), true);
  });
});
