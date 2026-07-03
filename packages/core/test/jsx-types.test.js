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
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'jsx');

/** Compile a single fixture and return its pre-emit diagnostics. */
function compile(file, importSource, jsx = ts.JsxEmit.ReactJSX) {
  const options = {
    strict: true,
    noEmit: true,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx,
    jsxImportSource: importSource,
    types: [],
  };
  const program = ts.createProgram([join(FIXTURES, file)], options);
  return ts.getPreEmitDiagnostics(program);
}

function messages(diags) {
  return diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
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
  const diags = compile('good.tsx', 'what-framework', ts.JsxEmit.Preserve);
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
