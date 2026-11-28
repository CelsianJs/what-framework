// Type-level regression test: an intrinsic element's event handlers type
// `e.currentTarget` as that element's DOM type (HTMLInputElement for an
// <input>, HTMLFormElement for a <form>, ...), as React's types do. Before, it
// was `EventTarget & Element`, so `e.currentTarget.value` in an <input>'s
// onInput needed a cast (found adopting What in the Vura dashboard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'jsx', 'event-targets.tsx');

for (const [importSource, jsx] of [['what-framework', 'react-jsx'], ['what-core', 'react-jsx'], ['what-framework', 'preserve']]) {
  test(`handlers see their element as currentTarget (${importSource}, jsx: ${jsx})`, () => {
    const diags = tscDiagnose({
      existingFiles: [FIXTURE],
      compilerOptions: { jsx, jsxImportSource: importSource, skipLibCheck: false },
    });
    assert.equal(diags.length, 0, `expected no diagnostics, got:\n${diags.map((d) => `${d.line}:${d.character} TS${d.code} ${d.message}`).join('\n')}`);
  });
}
