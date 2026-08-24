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
// This asserts the two directions that matter:
//
//   1. every ERR_* literal thrown under packages/*/src exists in the catalogue
//   2. every catalogue entry is complete and its code is unique

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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

// --- 2. Literals in source match the catalogue ------------------------------

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (entry.endsWith('.js')) yield full;
  }
}

// Only `code:` properties and quoted bare codes count. A code named inside a
// comment or a suggestion string is documentation, not a claim.
const CODE_PROP = /\bcode:\s*['"`](ERR_[A-Z0-9_]+)['"`]/g;

for (const pkg of readdirSync(packagesDir)) {
  const srcDir = join(packagesDir, pkg, 'src');
  try {
    if (!statSync(srcDir).isDirectory()) continue;
  } catch {
    continue;
  }
  for (const file of sourceFiles(srcDir)) {
    // The catalogue itself defines them; it is not a consumer.
    if (file.endsWith(join('core', 'src', 'errors.js'))) continue;
    const text = readFileSync(file, 'utf8');
    for (const [, code] of text.matchAll(CODE_PROP)) {
      if (!seenCodes.has(code)) {
        problems.push(
          `${relative(root, file)} throws "${code}", which is not in what-core's ERROR_CODES. ` +
          'Add it to packages/core/src/errors.js with a suggestion and an example.',
        );
      }
    }
  }
}

if (problems.length) {
  console.error('[error-codes] FAIL');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `[error-codes] OK: ${seenCodes.size} codes catalogued, every ERR_* literal under packages/*/src is one of them.`,
);
