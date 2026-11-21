// The documentation snippet gate (scripts/docs/snippets.mjs): every code block
// shipped to agents and users parses, compiles with what-compiler, imports only
// what the What packages export, and, when it stands alone, runs, mounts and
// survives a click on every button without an error or a diagnostic. One test
// per source, so a failure names the document. `npm run check:snippets` prints
// the same result as a full report.

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkSnippets, collectSnippets, formatFailures } from '../snippets.mjs';

const { snippets, counts } = await collectSnippets();

describe('documentation snippets', () => {
  let results;

  before(async () => {
    results = await checkSnippets(snippets);
  }, { timeout: 240_000 });

  for (const label of [...counts.keys()].sort()) {
    it(label, () => {
      const failing = results.filter((r) => r.snippet.source === label && r.failures.length);
      assert.equal(failing.length, 0, `${failing.length} snippet(s) in ${label} fail:\n${formatFailures(failing).join('\n')}`);
    });
  }
});
