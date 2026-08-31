// Type-level regression test for the shipped JSX runtime declarations
// (packages/core/jsx-runtime.d.ts + jsx-dev-runtime.d.ts, re-exported by
// what-framework). Guards against the "JSX has no type checking" DX gap:
// before these declarations, authoring JSX with
//   "jsx": "react-jsx", "jsxImportSource": "what-framework"
// failed under strict mode with TS7026 (no JSX.IntrinsicElements) and TS7016
// (no declaration for `what-framework/jsx-runtime`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'jsx');

/** Compile a single fixture and return its pre-emit diagnostics. */
function compile(file, importSource, jsx = 'react-jsx') {
  return tscDiagnose({
    existingFiles: [join(FIXTURES, file)],
    compilerOptions: {
      jsx,
      jsxImportSource: importSource,
      skipLibCheck: false,
    },
  });
}

function messages(diags) {
  return diags.map((d) => d.message);
}

test('valid What JSX type-checks clean via what-framework/jsx-runtime', () => {
  const diags = compile('good.tsx', 'what-framework');
  assert.equal(
    diags.length,
    0,
    `expected no diagnostics, got:\n${messages(diags).join('\n')}`,
  );
});

test('valid What JSX type-checks clean via what-core/jsx-runtime', () => {
  const diags = compile('good.tsx', 'what-core');
  assert.equal(
    diags.length,
    0,
    `expected no diagnostics, got:\n${messages(diags).join('\n')}`,
  );
});

test('valid What JSX type-checks clean under jsx:"preserve" (the create-what scaffold config)', () => {
  const diags = compile('good.tsx', 'what-framework', 'preserve');
  assert.equal(
    diags.length,
    0,
    `expected no diagnostics, got:\n${messages(diags).join('\n')}`,
  );
});

test('control-flow components and null-returning components type-check clean', () => {
  const diags = compile('control-flow.tsx', 'what-framework');
  assert.equal(
    diags.length,
    0,
    `expected no diagnostics, got:\n${messages(diags).join('\n')}`,
  );
});

test('invalid JSX is rejected — types are not blanket any', () => {
  const diags = compile('bad.tsx', 'what-framework');
  assert.ok(diags.length > 0, 'expected a type error for a string onclick handler');
  // TS2322: Type 'string' is not assignable to type 'EventHandler<...>'.
  assert.ok(
    diags.some((d) => d.code === 2322),
    `expected TS2322 assignability error, got: ${messages(diags).join('\n')}`,
  );
});
