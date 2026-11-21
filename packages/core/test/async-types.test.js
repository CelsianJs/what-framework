// The declarations of the async surface (packages/core/index.d.ts and the JSX
// runtime's): the patterns docs/ASYNC.md teaches type-check, and the React
// habits that break at run time do not. fixtures/api/async-probe.tsx must be
// clean; each line of fixtures/api/async-mistakes.tsx marked `// TS<code>`
// must raise exactly that error, and no other line any.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, 'fixtures', 'api', 'async-probe.tsx');
const MISTAKES = join(HERE, 'fixtures', 'api', 'async-mistakes.tsx');
const options = { jsx: 'react-jsx', jsxImportSource: 'what-framework', skipLibCheck: false };

test('the async patterns the docs teach type-check against the shipped declarations', () => {
  const diags = tscDiagnose({ existingFiles: [PROBE], compilerOptions: options });
  assert.deepEqual(diags.map((d) => `${d.line}: TS${d.code} ${d.message}`), []);
});

test('the React habits that break at run time are type errors', () => {
  const expected = readFileSync(MISTAKES, 'utf8').split('\n')
    .map((line, i) => [i + 1, line.match(/\/\/ TS(\d+)$/)?.[1]])
    .filter(([, code]) => code !== undefined)
    .map(([line, code]) => `${line}: TS${code}`);
  const actual = [...new Set(tscDiagnose({ existingFiles: [MISTAKES], compilerOptions: options })
    .map((d) => `${d.line}: TS${d.code}`))];
  assert.deepEqual(actual, expected);
});
