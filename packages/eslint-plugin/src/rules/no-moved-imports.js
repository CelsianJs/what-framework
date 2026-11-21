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

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
    };
  },
};
