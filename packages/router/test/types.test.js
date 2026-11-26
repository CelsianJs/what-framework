// Type-level regression test for what-router's hand-written declarations:
// a repeated query key is typed as an array of its values (RouteQuery), and
// route middleware's context carries the destination's full `url`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('router query and middleware types compile clean', () => {
  const diags = tscDiagnose({
    existingFiles: [join(HERE, 'fixtures', 'types', 'probe.ts')],
    compilerOptions: { skipLibCheck: false, lib: ['ES2022', 'DOM', 'DOM.Iterable'] },
  });
  assert.equal(diags.length, 0, `expected no diagnostics, got:\n${diags.map((d) => `${d.file}:${d.line} TS${d.code} ${d.message}`).join('\n')}`);
});

test('docs/TYPESCRIPT.md\'s typed preload page compiles clean', () => {
  const docs = readFileSync(join(HERE, '../../../docs/TYPESCRIPT.md'), 'utf8');
  const example = docs.split('A route list typed as `RouteConfig[]`')[1].match(/```tsx\n([\s\S]*?)```/)[1];
  assert.match(example, /RouteComponentProps<ReturnType<typeof loadUser>>/);
  const diags = tscDiagnose({
    files: { 'typed-preload.tsx': example },
    writeRoot: join(HERE, 'fixtures', 'types'),
    compilerOptions: { lib: ['ES2022', 'DOM', 'DOM.Iterable'], jsx: 'preserve', jsxImportSource: 'what-framework' },
  });
  assert.equal(diags.length, 0, `expected no diagnostics, got:\n${diags.map((d) => `${d.file}:${d.line} TS${d.code} ${d.message}`).join('\n')}`);
});
