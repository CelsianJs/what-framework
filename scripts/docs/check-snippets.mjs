#!/usr/bin/env node
// Check every code snippet that ships to agents and users, and print the report.
//
//   npm run check:snippets            failures by source, then the counts
//   npm run check:snippets -- --notes also why each snippet was not run or mounted
//
// Exits 1 when any snippet fails. scripts/docs/test/snippets.test.mjs runs the
// same check in the test suite.

import { checkSnippets, collectSnippets, formatReport } from './snippets.mjs';

const started = Date.now();
const { snippets, counts } = await collectSnippets();
const results = await checkSnippets(snippets);
console.log(formatReport(results, counts, { notes: process.argv.includes('--notes') }));
console.log(`(${((Date.now() - started) / 1000).toFixed(1)} s)`);
process.exitCode = results.some((r) => r.failures.length) ? 1 : 0;
