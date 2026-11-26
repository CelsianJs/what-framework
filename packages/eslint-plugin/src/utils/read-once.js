/**
 * The read-once shapes what-compiler reports at build time (ERR_PROP_READ_ONCE,
 * ERR_STATE_READ_ONCE, ERR_CLEANUP_READS_LIVE, packages/compiler/src/babel/
 * common.js), found on ESTree for code the compiler does not build: the
 * islands template's automatic JSX runtime and h() files. A component runs
 * once, so what its body reads outside JSX and outside a function is read
 * once, where React reads it again on every render:
 *
 * - its return decided by a prop or by its own state (`if (!props.open)
 *   return null`, `if (loading()) return <Spinner />`, `return open() ? … : …`);
 * - a value derived from its state in the body and shown in JSX
 *   (`const valid = name().length > 0; … disabled={!valid}`);
 * - a useEffect cleanup that reads a prop or state its run also reads, in an
 *   effect that runs again (no `[]`): the cleanup sees the new value.
 *
 * A component is a function named with a capital letter (`function Card`,
 * `const Card = (props) => …`, through `memo(…)`/`forwardRef(…)`) that renders
 * JSX or calls What's h(), as the compiler counts one. State is
 * what a What hook or primitive returns, declared in the component's body,
 * imported from what-framework or what-core.
 */

import { whatImport } from './what-state.js';

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const STATE_SOURCES = new Set(['signal', 'computed', 'useState', 'useReducer', 'useSignal', 'useComputed', 'useMemo', 'useTransition', 'useOptimistic', 'useActionState', 'createResource']);
const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'start', 'end', 'leadingComments', 'trailingComments', 'comments', 'tokens']);

/** The component's name, or null when `fn` is not one. */
export function componentName(fn) {
  let name = fn.id?.name;
  if (!name) {
    let at = fn.parent;
    while (at?.type === 'CallExpression') at = at.parent;
    if (at?.type === 'VariableDeclarator' && at.id.type === 'Identifier') name = at.id.name;
  }
  return name && /^[A-Z]/.test(name) ? name : null;
}

function unwrap(expr) {
  while (expr && (expr.type === 'TSAsExpression' || expr.type === 'TSNonNullExpression' || expr.type === 'ParenthesizedExpression')) expr = expr.expression;
  return expr;
}

/** Calls `visit` for each node of `node`, not entering functions written in it. */
function walk(node, visit) {
  if (!node || typeof node.type !== 'string' || FUNCTIONS.has(node.type)) return;
  if (visit(node) === false) return;
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) { for (const c of child) if (c && typeof c.type === 'string') walk(c, visit); }
    else if (child && typeof child.type === 'string') walk(child, visit);
  }
}

function containsReturn(stmt) {
  let found = false;
  walk(stmt, (n) => { if (n.type === 'ReturnStatement') found = true; });
  return found;
}

/** Whether `fn` renders: JSX, or a call of What's h() (imported from what-framework or what-core). */
function renders(fn, sourceCode) {
  return containsJsx(fn) || containsJsx(fn, (n) => n.type === 'CallExpression' && whatImport(sourceCode, n.callee) === 'h');
}

function containsJsx(fn, match = (n) => n.type === 'JSXElement' || n.type === 'JSXFragment') {
  let found = false;
  const visit = (n) => {
    if (found || !n || typeof n.type !== 'string') return;
    if (match(n)) { found = true; return; }
    for (const key of Object.keys(n)) {
      if (SKIP_KEYS.has(key)) continue;
      const child = n[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === 'string') visit(child);
    }
  };
  visit(fn.body);
  return found;
}

function patternNames(pattern, out = new Set()) {
  if (!pattern) return out;
  if (pattern.type === 'Identifier') out.add(pattern.name);
  else if (pattern.type === 'AssignmentPattern') patternNames(pattern.left, out);
  else if (pattern.type === 'RestElement') patternNames(pattern.argument, out);
  else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties) patternNames(p.type === 'RestElement' ? p : p.value, out);
  else if (pattern.type === 'ArrayPattern') for (const e of pattern.elements) patternNames(e, out);
  return out;
}

/** A function naming the prop a node reads (`props.open`, or a destructured `open`), else null. */
function propReader(fn) {
  const param = fn.params[0];
  if (!param) return null;
  if (param.type === 'Identifier') {
    return (n) => (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === param.name && n.property.type === 'Identifier'
      ? `props.${n.property.name}` : null);
  }
  if (param.type !== 'ObjectPattern') return null;
  const names = patternNames(param);
  return (n) => {
    if (n.type !== 'Identifier' || !names.has(n.name)) return null;
    // A key, a property name or a binding, not a read.
    const p = n.parent;
    if (p?.type === 'MemberExpression' && p.property === n && !p.computed) return null;
    if (p?.type === 'Property' && p.key === n && !p.computed && !p.shorthand) return null;
    return n.name;
  };
}

/** The state accessors the component's body declares. */
function stateAccessors(fn, sourceCode) {
  const names = new Set();
  if (fn.body.type !== 'BlockStatement') return names;
  for (const stmt of fn.body.body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const decl of stmt.declarations) {
      if (decl.init?.type !== 'CallExpression' || !STATE_SOURCES.has(whatImport(sourceCode, decl.init.callee) ?? '')) continue;
      const id = decl.id.type === 'ArrayPattern' ? decl.id.elements[0] : decl.id;
      if (id?.type === 'Identifier') names.add(id.name);
    }
  }
  return names;
}

function isStateCall(n, names) {
  return n.type === 'CallExpression' && n.arguments.length === 0 && n.callee.type === 'Identifier' && names.has(n.callee.name);
}

/** The first name `read` gives for a node of `node`, outside functions. */
function firstRead(node, read) {
  let found = null;
  walk(node, (n) => {
    if (found !== null) return false;
    found = read(n);
    return found === null;
  });
  return found;
}

function allReads(node, read) {
  const found = new Set();
  walk(node, (n) => { const name = read(n); if (name !== null) found.add(name); });
  return found;
}

/** The tests that decide what the component returns: a returned ternary's or logical's, an `if` that returns. */
function branchTests(fn) {
  const tests = [];
  const branch = (expr) => {
    expr = unwrap(expr);
    if (expr?.type === 'ConditionalExpression') tests.push(expr.test);
    else if (expr?.type === 'LogicalExpression') tests.push(expr.left);
  };
  if (fn.body.type !== 'BlockStatement') branch(fn.body);
  else {
    for (const stmt of fn.body.body) {
      if (stmt.type === 'ReturnStatement') branch(stmt.argument);
      else if (stmt.type === 'IfStatement' && containsReturn(stmt)) tests.push(stmt.test);
    }
  }
  return tests;
}

function text(sourceCode, node, fallback) {
  const t = sourceCode.getText(node);
  return t.length <= 60 ? t : fallback;
}

/**
 * The read-once findings of the component `fn`: { code, node, name, why, fix }.
 * @returns {{ code: string, node: any, name: string, component: string, why: string, fix: string }[]}
 */
export function readOnceFindings(fn, sourceCode) {
  const component = componentName(fn);
  if (component === null || !renders(fn, sourceCode)) return [];
  const findings = [];
  const props = propReader(fn);
  const state = stateAccessors(fn, sourceCode);
  const stateRead = (n) => (isStateCall(n, state) ? `${n.callee.name}()` : null);
  const tests = branchTests(fn);

  if (props !== null) {
    for (const test of tests) {
      const name = firstRead(test, props);
      if (name === null) continue;
      findings.push({ code: 'ERR_PROP_READ_ONCE', node: test, name, component,
        why: 'it decides what the component returns, and the component runs once',
        fix: `branch where it renders, \`<>{() => (${text(sourceCode, test, name)} ? <A /> : <B />)}</>\` or \`<Show when={…}>\`, with h() \`() => (cond ? h(…) : null)\`` });
      break;
    }
  }

  if (state.size > 0 && fn.body.type === 'BlockStatement') {
    for (const test of tests) {
      const read = firstRead(test, stateRead);
      if (read === null) continue;
      const cond = text(sourceCode, test, read);
      findings.push({ code: 'ERR_STATE_READ_ONCE', node: test, name: read, component,
        why: 'it decides what the component returns',
        fix: `branch where it renders, \`<>{() => (${cond} ? <A /> : <B />)}</>\` or \`<Show when={() => ${cond}}>\`` });
      break;
    }
    if (containsJsx(fn)) {
      for (const stmt of fn.body.body) {
        if (stmt.type !== 'VariableDeclaration') continue;
        for (const decl of stmt.declarations) {
          if (decl.id.type !== 'Identifier' || !decl.init || (decl.init.type === 'CallExpression' && STATE_SOURCES.has(whatImport(sourceCode, decl.init.callee) ?? ''))) continue;
          const read = firstRead(decl.init, stateRead);
          if (read === null) continue;
          const variable = sourceCode.getDeclaredVariables(decl)[0];
          const shown = variable?.references.some((ref) => {
            for (let p = ref.identifier.parent; p && p !== fn; p = p.parent) {
              if (p.type === 'JSXExpressionContainer' || p.type === 'JSXSpreadAttribute') return true;
            }
            return false;
          });
          if (!shown) continue;
          findings.push({ code: 'ERR_STATE_READ_ONCE', node: decl, name: read, component,
            why: `\`${decl.id.name}\` is computed from it in the component body and shown in JSX, so it keeps its first value`,
            fix: `write the expression in the JSX inside a function, \`{() => …}\`, or derive it with \`computed(() => …)\` and call it there (\`${decl.id.name}()\`)` });
        }
      }
    }
  }

  if (fn.body.type === 'BlockStatement' && (props !== null || state.size > 0)) {
    const read = (n) => (props !== null ? props(n) : null) ?? stateRead(n);
    for (const stmt of fn.body.body) {
      const call = stmt.type === 'ExpressionStatement' ? stmt.expression : null;
      if (call?.type !== 'CallExpression' || whatImport(sourceCode, call.callee) !== 'useEffect') continue;
      const [callback, deps] = call.arguments;
      if (!callback || !FUNCTIONS.has(callback.type) || (deps?.type === 'ArrayExpression' && deps.elements.length === 0)) continue;
      const cleanups = callback.body.type === 'BlockStatement'
        ? callback.body.body.filter((s) => s.type === 'ReturnStatement' && s.argument && FUNCTIONS.has(s.argument.type)).map((s) => s.argument)
        : FUNCTIONS.has(callback.body.type) ? [callback.body] : [];
      if (cleanups.length === 0) continue;
      const inRun = allReads(callback.body, read);
      for (const cleanup of cleanups) {
        const name = [...allReads(cleanup.body, read)].find((n) => inRun.has(n));
        if (name === undefined) continue;
        const local = name.replace(/^props\./, '').replace(/\(\)$/, '');
        findings.push({ code: 'ERR_CLEANUP_READS_LIVE', node: cleanup, name, component,
          why: 'the cleanup reads it after the change that makes the effect run again, so it sees the new value where React\'s cleanup sees the old one',
          fix: `keep the value the run used in a local (\`const ${local}Used = ${name};\`) and use it in the run and in the cleanup` });
        break;
      }
    }
  }
  return findings;
}

const REACT_SOURCES = /^(react|react-dom|preact)(\/|$)/;

/**
 * The visitors of a rule that reports the findings with `code`. A React file
 * (one that imports react, react-dom or preact: what-react runs it as React,
 * which renders again) is not checked.
 */
export function readOnceRule(code, context) {
  const sourceCode = context.sourceCode ?? context.getSourceCode();
  const react = sourceCode.ast.body.some((s) => s.type === 'ImportDeclaration' && REACT_SOURCES.test(String(s.source.value)));
  if (react) return {};
  const check = (fn) => {
    for (const f of readOnceFindings(fn, sourceCode)) {
      if (f.code === code) context.report({ node: f.node, messageId: 'readOnce', data: { name: f.name, component: f.component, why: f.why, fix: f.fix } });
    }
  };
  return { FunctionDeclaration: check, FunctionExpression: check, ArrowFunctionExpression: check };
}
