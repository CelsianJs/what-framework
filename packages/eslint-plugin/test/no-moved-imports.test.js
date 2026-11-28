// what/no-moved-imports, through the real ESLint Linter and its fixer: every
// answer comes from IMPORT_CHANGES, the table docs/UPGRADING.md, what-compiler's
// Vite plugin and validateImports() use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Linter } from 'eslint';
import * as espree from 'espree';
import { ERROR_CODES, IMPORT_CHANGES, SUBPATH_ONLY } from 'what-core/internal';
import what from '../src/index.js';

const RULE = 'what/no-moved-imports';

// espree has no TypeScript syntax. This blanks the `type` modifiers of import
// and export clauses (same length, so every location holds), parses with
// espree, and marks importKind/exportKind the way @typescript-eslint/parser does.
const typeModifiers = {
  parseForESLint(code) {
    const blanked = [];
    const js = code.replace(/(\b(?:import|export)\s+|[{,]\s*)type(?=\s+[\w${])/g, (match, before, offset) => {
      blanked.push(offset + before.length);
      return `${before}    `;
    });
    const ast = espree.parse(js, { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true, tokens: true, comment: true });
    for (const node of ast.body) {
      if (node.type !== 'ImportDeclaration' && node.type !== 'ExportNamedDeclaration') continue;
      const key = node.type === 'ImportDeclaration' ? 'importKind' : 'exportKind';
      node[key] = blanked.some((b) => /^(?:import|export)\s+$/.test(js.slice(node.range[0], b))) ? 'type' : 'value';
      for (const s of node.specifiers) {
        s[key] = blanked.some((b) => b < s.range[0] && /^\s+$/.test(js.slice(b + 4, s.range[0]))) ? 'type' : 'value';
      }
    }
    return { ast };
  },
};

function lint(code, { preset = 'compiler', parser } = {}) {
  const config = { ...what.configs[preset], languageOptions: { ...what.configs[preset].languageOptions, ...(parser ? { parser } : {}) } };
  const linter = new Linter();
  const messages = linter.verify(code, [config], { filename: 'app.jsx' }).filter((m) => m.ruleId === RULE);
  const { output } = linter.verifyAndFix(code, [config], { filename: 'app.jsx' });
  return { messages, output };
}

const answer = (name) => IMPORT_CHANGES.find((c) => c.name === name).answer;

test('splits an import per destination, leaving the root names in place', () => {
  const { messages, output } = lint("import { signal, useForm, Spinner } from 'what-framework';");
  assert.deepEqual(messages.map((m) => m.message), [
    `"useForm" is not exported by what-framework. ${answer('useForm')}`,
    `"Spinner" is not exported by what-framework. ${answer('Spinner')}`,
  ]);
  assert.equal(output, [
    "import { signal } from 'what-framework';",
    "import { useForm } from 'what-framework/form';",
    "import { Spinner } from 'what-framework/ui';",
  ].join('\n'));
});

test('keeps aliases, groups names that share a destination, and keeps the quote and semicolon style', () => {
  const { output } = lint('import { useForm as form, rules, useFocusTrap as trap } from "what-framework"');
  assert.equal(output, [
    'import { useForm as form, rules } from "what-framework/form"',
    'import { useFocusTrap as trap } from "what-framework/a11y"',
  ].join('\n'));
});

test('a renamed name moves under its new name and keeps its local binding', () => {
  assert.equal(lint("import { transition } from 'what-framework';").output, "import { transitionClass as transition } from 'what-framework/motion';");
  assert.equal(lint("import { transition as animate } from 'what-framework';").output, "import { transitionClass as animate } from 'what-framework/motion';");
  assert.equal(lint("import { transitionClass } from 'what-framework';").output, "import { transitionClass } from 'what-framework/motion';");
});

test('React\'s useTransition on the root entry is left alone, and the animation helper is pointed at its module', () => {
  assert.deepEqual(lint("import { useTransition, startTransition } from 'what-framework';").messages, []);
  const tween = lint("import { useTween } from 'what-framework';");
  assert.equal(tween.output, "import { useTween } from 'what-framework/motion';");
  assert.match(tween.messages[0].message, /^"useTween" is not exported by what-framework\. The animation helper formerly named useTransition is useTween\./);
});

test('a removed name is reported and left in place; the moved names beside it are still fixed', () => {
  const removed = lint("import { getCollectedErrors } from 'what-framework';");
  assert.equal(removed.messages.length, 1);
  assert.equal(removed.messages[0].fix, undefined);
  assert.match(removed.messages[0].message, /^"getCollectedErrors" is not exported by what-framework\. It was removed in 0\.15\. Use getDiagnostics/);
  assert.equal(removed.output, "import { getCollectedErrors } from 'what-framework';");

  const mixed = lint("import { effect, getHealth, useSWR } from 'what-framework';");
  assert.equal(mixed.messages.length, 2);
  assert.equal(mixed.output, "import { effect, getHealth } from 'what-framework';\nimport { useSWR } from 'what-framework/data';");
});

test('an import from what-core moves to the what-core twin of the kit', () => {
  assert.equal(
    lint("import { signal, useForm, _setTextInsertHook } from 'what-core';").output,
    "import { signal } from 'what-core';\nimport { useForm } from 'what-core/form';\nimport { _setTextInsertHook } from 'what-core/render';",
  );
});

test('a router name imported from what-framework is answered and moves to what-framework/router', () => {
  const routerAnswer = (name) => SUBPATH_ONLY.find((c) => c.name === name).answer;
  const { messages, output } = lint("import { mount, Router, Link as A } from 'what-framework';");
  assert.deepEqual(messages.map((m) => m.message), [
    `"Router" is not exported by what-framework. ${routerAnswer('Router')}`,
    `"Link" is not exported by what-framework. ${routerAnswer('Link')}`,
  ]);
  assert.equal(routerAnswer('Router'), "The router lives in what-framework/router. Import it with: import { Router } from 'what-framework/router'.");
  assert.equal(output, "import { mount } from 'what-framework';\nimport { Router, Link as A } from 'what-framework/router';");
  assert.equal(lint("const { navigate } = await import('what-framework');").output, "const { navigate } = await import('what-framework/router');");
});

test('a name of a kit what-core has no twin of, imported from what-core, is answered and left in place', () => {
  const { messages, output } = lint("import { Island, useForm } from 'what-core';");
  assert.deepEqual(messages.map((m) => [m.message.split('.')[0], m.fix === undefined]), [
    ['"Island" is not exported by what-core', true],
    ['"useForm" is not exported by what-core', false],
  ]);
  assert.equal(output, "import { Island } from 'what-core';\nimport { useForm } from 'what-core/form';");
});

test('the what-core kits the fix moves to are the subpaths what-core exports', async () => {
  const { CORE_KITS } = await import('../src/rules/no-moved-imports.js');
  const { exports } = JSON.parse(readFileSync(new URL('../../core/package.json', import.meta.url), 'utf8'));
  const kits = Object.keys(exports).map((k) => k.slice(2)).filter((k) => k !== '' && !k.includes('/') && !k.startsWith('jsx'));
  assert.deepEqual([...CORE_KITS].sort(), kits.sort());
});

test('a router name imported from what-core is answered and left in place: what-core has no router', () => {
  const { messages, output } = lint("import { signal, useForm, Router } from 'what-core';");
  assert.deepEqual(messages.map((m) => [m.message.split('.')[0], m.fix === undefined]), [
    ['"useForm" is not exported by what-core', false],
    ['"Router" is not exported by what-core', true],
  ]);
  assert.equal(output, "import { signal, Router } from 'what-core';\nimport { useForm } from 'what-core/form';");
  assert.equal(lint("const { navigate } = await import('what-core');").output, "const { navigate } = await import('what-core');");
});

test('re-exports from the root entry move too', () => {
  assert.equal(
    lint("export { useForm, transition as animate } from 'what-framework';").output,
    "export { useForm } from 'what-framework/form';\nexport { transitionClass as animate } from 'what-framework/motion';",
  );
});

test('type-only imports stay type-only', () => {
  const parser = typeModifiers;
  assert.equal(
    lint("import type { useForm, Spinner } from 'what-framework';", { parser }).output,
    "import type { useForm } from 'what-framework/form';\nimport type { Spinner } from 'what-framework/ui';",
  );
  assert.equal(
    lint("import { type Signal, signal, type useForm } from 'what-framework';", { parser }).output,
    "import { type Signal, signal } from 'what-framework';\nimport { type useForm } from 'what-framework/form';",
  );
});

test('imports that are already right are left alone', () => {
  const clean = [
    "import { signal, effect, h } from 'what-framework';",
    "import { useForm } from 'what-framework/form';",
    "import { useTween } from 'what-framework/motion';",
    "import * as what from 'what-framework';",
    "import { useForm } from './form.js';",
    "export const useForm = () => null;",
  ].join('\n');
  assert.deepEqual(lint(clean).messages, []);
});

test('a comment inside the braces is reported but not rewritten', () => {
  const code = "import { /* forms */ useForm } from 'what-framework';";
  const { messages, output } = lint(code);
  assert.equal(messages.length, 1);
  assert.equal(output, code);
});

test('it is an error in every preset, and its code is in the catalogue', () => {
  for (const preset of ['recommended', 'strict', 'compiler']) {
    assert.equal(what.configs[preset].rules[RULE], 'error', preset);
    assert.equal(lint("import { useForm } from 'what-framework';", { preset }).messages[0].severity, 2, preset);
  }
  const code = what.rules['no-moved-imports'].meta.docs.code;
  assert.equal(code, 'ERR_MOVED_IMPORT');
  assert.ok(Object.values(ERROR_CODES).some((def) => def.code === code));
});

test('a dynamic import of the root entry: destructured, read as a member, or in .then()', () => {
  const awaited = lint("export async function load() { const { useQuery, setQueryData } = await import('what-framework'); return [useQuery, setQueryData]; }");
  assert.deepEqual(awaited.messages.map((m) => m.message), [
    `"useQuery" is not exported by what-framework. ${answer('useQuery')}`,
    `"setQueryData" is not exported by what-framework. ${answer('setQueryData')}`,
  ]);
  assert.match(awaited.output, /await import\('what-framework\/data'\)/, 'every name moved to /data: the import takes that path');

  const member = lint("export async function f() { return (await import('what-framework')).useForm; }");
  assert.equal(member.messages.length, 1);
  assert.equal(member.output.includes("import('what-framework')"), true, 'a member read is reported, not rewritten');

  const then = lint("export const p = import('what-framework').then(({ useForm }) => useForm);");
  assert.equal(then.messages.length, 1);
  assert.match(then.output, /import\('what-framework\/form'\)/);

  const thenMember = lint("export const p = import('what-framework').then((m) => m.useForm);");
  assert.equal(thenMember.messages.length, 1);
  assert.match(thenMember.output, /import\('what-framework\/form'\)/);

  const mixed = lint("export async function f() { const { signal, useForm } = await import('what-framework'); return [signal, useForm]; }");
  assert.equal(mixed.messages.length, 1, 'only the moved name');
  assert.equal(mixed.output.includes("import('what-framework')"), true, 'a name that stays keeps the root import: reported only');

  assert.deepEqual(lint("export const p = import('what-framework').then((m) => m.signal);").messages, []);
});
