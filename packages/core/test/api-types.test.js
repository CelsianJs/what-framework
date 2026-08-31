// Type-level regression test for the shipped API declarations
// (packages/core/index.d.ts, re-exported by what-framework). The .d.ts files are
// hand-written with no generation step, so they silently drift from the runtime.
// Regressions this guards:
//   - signal(initial, debugName) declared as one-arg -> TS2554 on line one of the tutorial
//   - Show/For/Switch and Component<P> returning VNodeChild -> TS2786 in JSX
//   - hydrate/useLoaderData/error+guardrail helpers undeclared -> TS2305
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'api', 'probe.tsx');

function messages(diags) {
  return diags.map((d) => d.message);
}

test('documented What APIs type-check clean against the shipped declarations', () => {
  const diags = tscDiagnose({
    existingFiles: [FIXTURE],
    compilerOptions: {
      jsx: 'react-jsx',
      jsxImportSource: 'what-framework',
      skipLibCheck: false,
    },
  });
  assert.equal(
    diags.length,
    0,
    `expected no diagnostics, got:\n${messages(diags).join('\n')}`,
  );
});
