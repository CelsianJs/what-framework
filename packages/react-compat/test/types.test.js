// Type-level regression test for what-react's shipped .d.ts declarations
// (index.d.ts, dom.d.ts, jsx-runtime.d.ts, jsx-dev-runtime.d.ts, vite.d.ts).
//
// Before these declarations, `import { useState } from 'what-react'` and JSX
// authored with jsxImportSource "what-react" resolved to `any`. This test
// drives the real TypeScript compiler API to assert the types are present,
// accurate, and NOT blanket `any` (valid usage compiles clean; wrong props /
// wrong hook argument types are rejected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'types');

/** Compile a single fixture and return its pre-emit diagnostics. */
function compile(file, jsx = ts.JsxEmit.ReactJSX) {
  const options = {
    strict: true,
    noEmit: true,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    jsx,
    jsxImportSource: 'what-react',
    skipLibCheck: true,
  };
  const program = ts.createProgram([join(FIXTURES, file)], options);
  return ts.getPreEmitDiagnostics(program);
}

function messages(diags) {
  return diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

test('valid what-react JSX + hooks type-check clean (react-jsx)', () => {
  const diags = compile('good.tsx');
  assert.equal(
    diags.length,
    0,
    `expected no diagnostics, got:\n${messages(diags).join('\n')}`,
  );
});

test('valid what-react JSX type-checks clean under jsx:"react-jsxdev"', () => {
  const diags = compile('good.tsx', ts.JsxEmit.ReactJSXDev);
  assert.equal(
    diags.length,
    0,
    `expected no diagnostics, got:\n${messages(diags).join('\n')}`,
  );
});

test('invalid JSX prop is rejected — element types are not blanket any', () => {
  const diags = compile('bad.tsx');
  assert.ok(diags.length > 0, 'expected a type error for a string onClick handler');
  assert.ok(
    diags.some((d) => d.code === 2322),
    `expected TS2322 assignability error, got: ${messages(diags).join('\n')}`,
  );
});

test('invalid hook argument is rejected — hook signatures are not blanket any', () => {
  const diags = compile('bad-hooks.ts');
  assert.ok(diags.length > 0, 'expected a type error for setCount("nope")');
  assert.ok(
    diags.some((d) => d.code === 2345),
    `expected TS2345 argument error, got: ${messages(diags).join('\n')}`,
  );
});
