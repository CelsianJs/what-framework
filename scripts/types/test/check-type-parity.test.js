// Regression test for scripts/check-type-parity.mjs.
//
// The .d.ts files in this repo are hand-written and no CI step ever compared
// them to the runtime, so declarations for exports that do not exist shipped
// silently: `import { redirect } from 'what-framework/router'` typechecked clean
// and then died at module load with "does not provide an export named 'redirect'".
//
// The gate is bidirectional. A forward-only check let 45 shipped server exports
// be invisible to every TypeScript user, which is how a capability gets built and
// then never adopted: the failure is silent in the other direction too.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { checkParity, checkConsumerProbes, declaredValues } from '../../check-type-parity.mjs';

test('no .d.ts declares an export the runtime does not provide, and nothing is silently skipped', async () => {
  const failures = await checkParity();
  assert.deepEqual(
    failures,
    [],
    `type parity problems found:\n${failures
      .map((f) => {
        const parts = [];
        if (f.unimportable) parts.push(f.unimportable);
        if (f.phantoms?.length) parts.push(`declared but not exported: ${f.phantoms.join(', ')}`);
        if (f.undeclared?.length) parts.push(`exported but not declared: ${f.undeclared.join(', ')}`);
        return `${f.types}: ${parts.join(' | ')}`;
      })
      .join('\n')}`,
  );
});

test('a strict TypeScript consumer can actually call the declared APIs', async () => {
  // Name parity is blind to SHAPE. `renderToString(vnode: VNode)` named a real
  // export and matched the runtime exactly, and was still a TS2345 for the SSR
  // guide's own first example, because `VNode<P>` is effectively invariant in P.
  // Nothing compiled a line of consumer code, so it could only be found by
  // installing the published packages.
  const failures = await checkConsumerProbes();
  assert.deepEqual(
    failures,
    [],
    `strict consumer probes did not compile:\n${failures
      .map((f) => `${f.probe}:\n  ${f.messages.join('\n  ')}`)
      .join('\n')}`,
  );
});

test('declaredValues collects value exports and ignores type-only ones', () => {
  const names = declaredValues(
    [
      'export function navigate(to: string): void;',
      'export const route: RouteState;',
      'export class WhatError extends Error {}',
      'export interface RouteState { url: string }',
      'export type Updater<T> = T;',
      'export { Fragment, jsx as jsxs } from "./index";',
    ].join('\n'),
    new Set(['RouteState', 'Updater']),
  );
  assert.deepEqual(
    [...names].sort(),
    ['Fragment', 'WhatError', 'jsxs', 'navigate', 'route'],
  );
});

test('declaredValues treats package-wide type names as non-values', () => {
  const source = 'export { JSX } from "./jsx-runtime";\nexport function jsx(): any;';
  assert.deepEqual([...declaredValues(source, new Set(['JSX']))], ['jsx']);
});

test('declaredValues follows `export * from` so a correct barrel is not reported as empty', () => {
  // packages/what/index.d.ts is exactly `export * from 'what-core'`. A checker
  // that does not follow the star reports every one of what-core's exports as
  // undeclared, which is how a reverse-direction gate gets disabled rather than
  // fixed.
  const url = new URL('../../../packages/what/index.d.ts', import.meta.url);
  const file = url.pathname;
  const names = declaredValues(readFileSync(file, 'utf8'), new Set(), file);
  assert.ok(names.has('signal'), 'star re-export must pull in what-core value exports');
  assert.ok(names.has('effect'));
  assert.ok(names.has('mount'));
});

test('declaredValues without a file path does not follow stars (no accidental resolution)', () => {
  const names = declaredValues("export * from 'what-core';\nexport function local(): void;");
  assert.deepEqual([...names], ['local']);
});
