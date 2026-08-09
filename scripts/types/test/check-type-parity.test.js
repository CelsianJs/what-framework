// Regression test for scripts/check-type-parity.mjs.
//
// The .d.ts files in this repo are hand-written and no CI step ever compared
// them to the runtime, so declarations for exports that do not exist shipped
// silently: `import { redirect } from 'what-framework/router'` typechecked clean
// and then died at module load with "does not provide an export named 'redirect'".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkParity, declaredValues } from '../../check-type-parity.mjs';

test('no .d.ts declares an export the runtime does not provide, and nothing is silently skipped', async () => {
  const failures = await checkParity();
  assert.deepEqual(
    failures,
    [],
    `type parity problems found:\n${failures
      .map((f) => `${f.types}: ${f.unimportable || f.phantoms.join(', ')}`)
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
