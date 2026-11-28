#!/usr/bin/env node
// Error-code catalogue gate.
//
// what-core's ERROR_CODES is the single catalogue for the whole framework: the
// what_errors MCP tool enumerates it, and it is the only place a code's
// suggestion and worked example live. Four packages cannot import it and still
// need its codes — what-isr is deliberately standalone, the compiler runs
// inside Babel at build time, the MCP server has no framework dependency, and
// the CLI loads the project's runtime rather than its own — so they carry the
// codes as string literals.
//
// A literal that drifts from the catalogue is invisible: the throw still works,
// the code still looks plausible, and the catalogue simply stops describing it.
// This asserts:
//
//   1. every catalogue entry is complete and its code is unique
//   2. every ERR_* code raised under packages/*/src exists in the catalogue
//   3. the generated copies (docs/ERRORS.md, diagnostics.json, skills) are in sync

import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { findRaiseSites } from './lib/error-raise-sites.mjs';

const root = resolve(import.meta.dirname, '..');
const packagesDir = join(root, 'packages');

const { ERROR_CODES } = await import(join(packagesDir, 'core/src/errors.js'));

const problems = [];

// --- 1. Catalogue completeness ---------------------------------------------

const seenCodes = new Map();
for (const [key, def] of Object.entries(ERROR_CODES)) {
  for (const field of ['code', 'severity', 'template', 'suggestion']) {
    if (!def[field] || typeof def[field] !== 'string') {
      problems.push(`ERROR_CODES.${key} is missing a \`${field}\``);
    }
  }
  if (def.code && !/^ERR_[A-Z0-9_]+$/.test(def.code)) {
    problems.push(`ERROR_CODES.${key}.code "${def.code}" is not ERR_UPPER_SNAKE`);
  }
  if (def.severity && !['error', 'warning'].includes(def.severity)) {
    problems.push(`ERROR_CODES.${key}.severity "${def.severity}" is not error|warning`);
  }
  if (seenCodes.has(def.code)) {
    problems.push(`ERROR_CODES.${key} reuses code "${def.code}" (also ${seenCodes.get(def.code)})`);
  }
  seenCodes.set(def.code, key);
}

// --- 2. Raised codes match the catalogue -------------------------------------
// A raise site is a thrown or reported code (see scripts/lib/error-raise-sites.mjs);
// a code named in a comment or a suggestion string is documentation, not a claim.

for (const { code, file } of findRaiseSites(packagesDir)) {
  if (!seenCodes.has(code)) {
    problems.push(
      `${relative(root, file)} raises "${code}", which is not in what-core's ERROR_CODES. ` +
      'Add it to packages/core/src/errors.js with a suggestion and an example.',
    );
  }
}

// --- 3. Generated catalogue copies are in sync --------------------------------
// docs/ERRORS.md, packages/what/diagnostics.json and the shipped skills are
// generated from the catalogue; a drifted copy fails here too, so one command
// gates the catalogue and everything derived from it.

const docs = spawnSync(process.execPath, [join(root, 'scripts', 'generate-error-docs.mjs'), '--check'], { encoding: 'utf8' });
if (docs.status !== 0) {
  problems.push(`generated catalogue copies drifted:\n${(docs.stderr || docs.stdout).trim()}`);
}

if (problems.length) {
  console.error('[error-codes] FAIL');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `[error-codes] OK: ${seenCodes.size} codes catalogued, every ERR_* code raised under packages/*/src is one of them, generated copies in sync.`,
);
