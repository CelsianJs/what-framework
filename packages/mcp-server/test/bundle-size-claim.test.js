// The published DOCS blurb claimed "~4kB gzipped" while the repo's own size
// harness measured 5.6 KB for the same bundle. Every place that ships a size
// claim must stay inside the measured reality recorded in .size-budgets.json
// (ceilings are measured + ~10% headroom).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');
const budgets = JSON.parse(readFileSync(resolve(repoRoot, '.size-budgets.json'), 'utf8'));
const ceiling = budgets.scenarios['core-counter'].limitGzipBytes;

// The floor used to be 80% of the ceiling, which is a band wide enough to hide
// the exact failure this file exists to catch: all three claims still read
// "~5.6 KB" long after the bundle measured 6.37 KB, and every one of them passed
// because 5.6 KB sits comfortably inside 5.1-6.38 KB. An UNDERSTATED size is the
// only direction anyone ever drifts, so a gate that tolerates 12% of it is not a
// gate. The ceiling is maintained as "measured, rounded up to the next 64 B"
// (see .size-budgets.json), so it tracks reality closely and 95% of it is a tight
// band around the real number rather than an arbitrary one.
const floor = ceiling * 0.95;

const claims = {
  'packages/mcp-server/src/index.js': /~([\d.]+) ?kB gzipped/i,
  'sites/benchmarks/index.html': /<td class="value">~([\d.]+) KB<\/td>/,
  'README.md': /counter app is ~?([\d.]+)KB/,
};

for (const [file, pattern] of Object.entries(claims)) {
  test(`${file} states a bundle size that matches the measured budget`, () => {
    const match = readFileSync(resolve(repoRoot, file), 'utf8').match(pattern);
    assert.ok(match, `no bundle size claim found in ${file}`);
    const bytes = Number(match[1]) * 1024;
    assert.ok(
      bytes >= floor && bytes <= ceiling,
      `${file} claims ${match[1]} KB (${bytes} B), outside the measured range ${Math.round(floor)}-${ceiling} B`,
    );
  });
}
