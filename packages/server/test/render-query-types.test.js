// Type-level regression test: renderDocument/renderPage and a loader's
// context take a parsed query whose repeated key is an array of its values,
// as what-router's parseQuery (RouteQuery) and the adapter produce it. Before,
// RenderRequestContext.query required scalar strings and rejected
// { tag: ['a', 'b'] }.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'types', 'render-query.ts');

test('server render contexts accept a query with repeated keys', () => {
  const diags = tscDiagnose({ existingFiles: [FIXTURE], compilerOptions: { skipLibCheck: false, lib: ['ES2022', 'DOM', 'DOM.Iterable'] } });
  assert.equal(diags.length, 0, `expected no diagnostics, got:\n${diags.map((d) => `${d.line}:${d.character} TS${d.code} ${d.message}`).join('\n')}`);
});
