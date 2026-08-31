// Type-level regression test for what-compiler's shipped .d.ts declarations
// (index.d.ts, vite.d.ts, babel.d.ts, file-router.d.ts, runtime.d.ts).
//
// Drives the real TypeScript compiler API to assert the public API types are
// present, accurate, and NOT blanket `any` (valid vite.config / file-router
// usage compiles clean; a wrong plugin-option type is rejected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'types');

function compile(file) {
  return tscDiagnose({
    existingFiles: [join(FIXTURES, file)],
    compilerOptions: {
      lib: ['es2022', 'dom'],
    },
  });
}

function messages(diags) {
  return diags.map((d) => d.message);
}

test('valid what-compiler public API usage type-checks clean', () => {
  const diags = compile('good.ts');
  assert.equal(
    diags.length,
    0,
    `expected no diagnostics, got:\n${messages(diags).join('\n')}`,
  );
});

test('invalid plugin option is rejected — compiler types are not blanket any', () => {
  const diags = compile('bad.ts');
  assert.ok(diags.length > 0, 'expected a type error for hot: "yes-please"');
  assert.ok(
    diags.some((d) => d.code === 2322 || d.code === 2769),
    `expected TS2322/2769 assignability error, got: ${messages(diags).join('\n')}`,
  );
});
