/**
 * Rule: what/no-moved-imports
 *
 * In 0.15 the root entry (what-framework, and what-core alike) kept the core
 * API: the domain kits moved to subpaths, a few names were renamed and some
 * were removed. The bundler only says "is not exported"; this rule gives each
 * name the answer IMPORT_CHANGES records (what-core/internal, the table
 * docs/UPGRADING.md and what-compiler's Vite plugin use), and its fix splits
 * the import per destination. A removed name has no destination, so it is
 * reported and left in place. An import from what-core moves to the what-core
 * twin of a what-framework/<kit> path, so a package that depends on what-core
 * alone keeps resolving.
 *
 * Bad:  import { signal, useForm, Spinner } from 'what-framework';
 * Good: import { signal } from 'what-framework';
 *       import { useForm } from 'what-framework/form';
 *       import { Spinner } from 'what-framework/ui';
 */

import { IMPORT_CHANGES } from 'what-core/internal';

const ROOT_ENTRIES = new Set(['what-framework', 'what-core']);

const nameOf = (node) => (node.type === 'Identifier' ? node.name : node.value);
const textOf = (node) => (node.type === 'Identifier' ? node.name : node.raw);

function changeFor(name) {
  return IMPORT_CHANGES.find((c) => (c.name === name && !c.onRoot) || c.as === name);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Import the names that left the root entry in 0.15 from where they live now',
      recommended: true,
      code: 'ERR_MOVED_IMPORT',
    },
    fixable: 'code',
    messages: {
      moved: '"{{name}}" is not exported by {{source}}. {{answer}}',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;

    // import { a as b } names `a` in the module and binds `b`; export { a as b }
    // from re-exports the module's `a` as `b`.
    function parts(specifier) {
      return specifier.type === 'ImportSpecifier'
        ? { remote: specifier.imported, binding: specifier.local, typeOnly: specifier.importKind === 'type' }
        : { remote: specifier.local, binding: specifier.exported, typeOnly: specifier.exportKind === 'type' };
    }

    // The declaration rewritten: what stays on the root entry stays in it, and
    // each destination gets its own declaration, in first-seen order. Built
    // from the AST rather than sliced from the source, so a `type` modifier
    // survives whichever parser placed it inside or outside a node's range.
    function rewrite(node, moves) {
      const source = node.source.value;
      const keyword = node.type === 'ImportDeclaration' ? 'import' : 'export';
      const kind = (node.importKind || node.exportKind) === 'type' ? ' type' : '';
      const quote = node.source.raw[0];
      const semi = sourceCode.getText(node).endsWith(';') ? ';' : '';

      const defaults = [];
      /** @type {Map<string, string[]>} */
      const byDestination = new Map([[source, []]]);
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportDefaultSpecifier') {
          defaults.push(specifier.local.name);
          continue;
        }
        const move = moves.get(specifier);
        const { remote, binding, typeOnly } = parts(specifier);
        const name = move?.as && nameOf(remote) === move.name ? move.as : textOf(remote);
        const local = textOf(binding);
        const to = !move ? source : source === 'what-core' ? move.to.replace(/^what-framework\//, 'what-core/') : move.to;
        const named = byDestination.get(to) || [];
        byDestination.set(to, named);
        named.push(`${typeOnly ? 'type ' : ''}${name === local ? name : `${name} as ${local}`}`);
      }

      const lines = [];
      for (const [to, named] of byDestination) {
        const clause = [...(to === source ? defaults : []), ...(named.length ? [`{ ${named.join(', ')} }`] : [])];
        if (clause.length) lines.push(`${keyword}${kind} ${clause.join(', ')} from ${quote}${to}${quote}${semi}`);
      }
      return lines.join(`\n${' '.repeat(node.loc.start.column)}`);
    }

    function check(node) {
      if (!node.source || !ROOT_ENTRIES.has(node.source.value)) return;
      const found = [];
      for (const specifier of node.specifiers) {
        if (specifier.type !== 'ImportSpecifier' && specifier.type !== 'ExportSpecifier') continue;
        const name = nameOf(parts(specifier).remote);
        const change = changeFor(name);
        if (change) found.push({ specifier, name, change });
      }
      if (!found.length) return;

      const moves = new Map(found.filter((f) => f.change.to).map((f) => [f.specifier, f.change]));
      // A comment inside the braces has no place in the rewritten declarations.
      const fixable = moves.size > 0 && sourceCode.getCommentsInside(node).length === 0;
      for (const { specifier, name, change } of found) {
        context.report({
          node: specifier,
          messageId: 'moved',
          data: { name, source: node.source.value, answer: change.answer },
          fix: fixable && change.to ? (fixer) => fixer.replaceText(node, rewrite(node, moves)) : null,
        });
      }
    }

    // A dynamic import of a root entry: the names it reads, in the shapes code
    // writes them. `const { a } = await import(x)`, `(await import(x)).a`,
    // `import(x).then(({ a }) => ...)` and `.then((m) => m.a)`.
    function readNames(node) {
      const names = [];
      const fromPattern = (pattern) => {
        if (pattern?.type !== 'ObjectPattern') return false;
        for (const p of pattern.properties) {
          if (p.type === 'Property' && !p.computed) names.push({ name: nameOf(p.key), node: p.key });
          else return false; // a rest element reads names we cannot see
        }
        return true;
      };
      let expr = node;
      let parent = node.parent;
      if (parent.type === 'AwaitExpression') {
        expr = parent;
        parent = parent.parent;
      }
      if (parent.type === 'VariableDeclarator' && parent.init === expr) {
        return fromPattern(parent.id) ? { names, whole: true } : null;
      }
      if (parent.type === 'MemberExpression' && parent.object === expr && !parent.computed) {
        if (expr === node && nameOf(parent.property) === 'then' && parent.parent.type === 'CallExpression') {
          const cb = parent.parent.arguments[0];
          if (!cb || (cb.type !== 'ArrowFunctionExpression' && cb.type !== 'FunctionExpression')) return null;
          const param = cb.params[0];
          if (fromPattern(param)) return { names, whole: true };
          if (param?.type !== 'Identifier') return null;
          // `(m) => m.a`: each `m.<name>` read in the callback.
          const scope = sourceCode.getScope ? sourceCode.getScope(cb) : null;
          const variable = scope?.variables.find((v) => v.name === param.name);
          for (const ref of variable?.references ?? []) {
            const member = ref.identifier.parent;
            if (member.type === 'MemberExpression' && member.object === ref.identifier && !member.computed) names.push({ name: nameOf(member.property), node: member.property });
            else return { names, whole: false };
          }
          return { names, whole: true };
        }
        names.push({ name: nameOf(parent.property), node: parent.property });
        return { names, whole: false };
      }
      return null;
    }

    function checkDynamic(node) {
      const src = node.source;
      if (src.type !== 'Literal' || !ROOT_ENTRIES.has(src.value)) return;
      const read = readNames(node);
      if (read === null) return;
      const found = read.names.map((n) => ({ ...n, change: changeFor(n.name) })).filter((n) => n.change);
      if (!found.length) return;
      // Fixable when every name it reads moved to one destination: the import
      // takes that path.
      const destinations = new Set(found.map((f) => f.change.to));
      const dest = read.whole && found.length === read.names.length && destinations.size === 1 && !found.some((f) => f.change.as) ? found[0].change.to : null;
      const to = dest === null ? null : src.value === 'what-core' ? dest.replace(/^what-framework\//, 'what-core/') : dest;
      for (const { name, node: at, change } of found) {
        context.report({
          node: at,
          messageId: 'moved',
          data: { name, source: src.value, answer: change.answer },
          fix: to ? (fixer) => fixer.replaceText(src, `${src.raw[0]}${to}${src.raw[0]}`) : null,
        });
      }
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ImportExpression: checkDynamic,
    };
  },
};
