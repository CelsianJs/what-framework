#!/usr/bin/env node

// Size budget gate — zero dependencies beyond the repo's own esbuild + node
// builtins. Bundles representative app entries against the PRODUCTION export
// condition (dist/*.min.js — exactly what npm consumers get), gzips them, and
// compares against the ceilings in .size-budgets.json.
//
// Prerequisite: `node scripts/build.js` (dist/ must exist).
// Usage:        node scripts/check-size.mjs
//
// Budgets are measured-reality + ~10% headroom. If a scenario legitimately
// grows past its ceiling, raise the budget in .size-budgets.json in the same
// PR — deliberately, with a reason in the diff.

import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const repoRoot = resolve(import.meta.dirname, '..');

const budgetsPath = resolve(repoRoot, '.size-budgets.json');
const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'));

// The production condition resolves what-core / what-framework to
// dist/*.min.js — those must exist or the measurement is meaningless.
const requiredDist = [
  'packages/core/dist/index.min.js',
  'packages/what/dist/index.min.js',
];
const missingDist = requiredDist.filter((f) => !existsSync(resolve(repoRoot, f)));
if (missingDist.length) {
  console.error('[check-size] Missing production build outputs:');
  for (const f of missingDist) console.error(`  - ${f}`);
  console.error('\nRun `node scripts/build.js` first.');
  process.exit(1);
}

// Scenario (a): the what-core runtime as imported by a typical counter app.
const coreCounter = `
import { signal, h, mount } from 'what-core';

function Counter() {
  const count = signal(0, 'count');
  return h('main', { class: 'app-shell' },
    h('h1', {}, 'What Framework'),
    h('section', { class: 'counter' },
      h('button', { onclick: () => count((c) => c - 1) }, '-'),
      h('output', {}, () => count()),
      h('button', { onclick: () => count((c) => c + 1) }, '+'),
    ),
  );
}

mount(h(Counter, {}), '#app');
`;

// Scenario (b): the create-what vanilla template entry (src/main.jsx,
// generateMainDefault in packages/create-what/index.js), bundled via the
// runtime JSX transform (jsxImportSource: what-framework). The compiled-
// template path the real scaffold uses (what-compiler/vite) emits less code,
// so this is a conservative upper bound for the scaffold counter.
const scaffoldCounter = `
import { mount, signal } from 'what-framework';

function App() {
  const count = signal(0);

  return (
    <main className="app-shell">
      <h1>What Framework</h1>
      <p>Compiler-first JSX, fine-grained signals.</p>

      <section className="counter">
        <button onClick={() => count(c => c - 1)}>-</button>
        <output>{count()}</output>
        <button onClick={() => count(c => c + 1)}>+</button>
      </section>
    </main>
  );
}

mount(<App />, '#app');
`;

const scenarios = {
  'core-counter': { source: coreCounter, loader: 'js' },
  'scaffold-counter': { source: scaffoldCounter, loader: 'jsx' },
};

async function measure(name, { source, loader }) {
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: repoRoot,
      sourcefile: `${name}.${loader}`,
      loader,
    },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    conditions: ['production'],
    treeShaking: true,
    write: false,
    logLevel: 'silent',
    ...(loader === 'jsx' ? { jsx: 'automatic', jsxImportSource: 'what-framework' } : {}),
  });
  const bytes = result.outputFiles[0].contents;
  return { minBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length };
}

const kb = (n) => `${(n / 1024).toFixed(2)} KB`;

let failed = false;
console.log('[check-size] production-condition bundle sizes (min+gzip):\n');

for (const [name, scenario] of Object.entries(scenarios)) {
  const budget = budgets.scenarios?.[name];
  if (!budget || typeof budget.limitGzipBytes !== 'number') {
    console.error(`  ✗ ${name}: no limitGzipBytes budget in .size-budgets.json`);
    failed = true;
    continue;
  }
  const { minBytes, gzipBytes } = await measure(name, scenario);
  const over = gzipBytes > budget.limitGzipBytes;
  const mark = over ? '✗' : '✓';
  console.log(
    `  ${mark} ${name}: min ${kb(minBytes)}, gzip ${kb(gzipBytes)} (${gzipBytes} B)` +
      ` — budget ${kb(budget.limitGzipBytes)} (${budget.limitGzipBytes} B)`,
  );
  if (over) {
    console.error(
      `    OVER BUDGET by ${gzipBytes - budget.limitGzipBytes} B.` +
        ' Shrink the runtime or raise the budget deliberately in .size-budgets.json.',
    );
    failed = true;
  }
}

console.log('');
if (failed) {
  console.error('[check-size] FAIL: size budget exceeded.');
  process.exit(1);
}
console.log('[check-size] OK: all scenarios within budget.');
