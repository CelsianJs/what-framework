// Where the framework raises an ERR_* code, found by scanning package sources.
// Shared by check-error-codes.mjs (every raised code must be catalogued) and
// generate-error-docs.mjs (which packages raise a code, and how it reaches you).
//
// Only raise sites count; a code named in a doc string or tool description
// does not. Each site says how the code is raised:
//   code: 'ERR_X'  /  err.code = 'ERR_X'        'code'    an error (or lint rule) carrying the code
//   report('ERR_X' / reportDiagnostic('ERR_X'   'report'  the development diagnostics channel
//   [what-compiler] ERR_X:                      'warning' a compiler build-time warning
//   '… (ERR_X)' ending a logged message         'log'     a line the package logs (what-server's warnings)
// The catalogue itself is skipped; the functions after it in errors.js
// (classifyError, createWhatError) are raise sites like any other.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAISE_SITES = [
  ['code', /\bcode:\s*['"`](ERR_[A-Z0-9_]+)['"`]/g],
  ['code', /\.code\s*=\s*['"`](ERR_[A-Z0-9_]+)['"`]/g],
  ['report', /\breport(?:Diagnostic)?\(\s*['"`](ERR_[A-Z0-9_]+)['"`]/g],
  ['warning', /\]\s(ERR_[A-Z0-9_]+):/g],
  ['log', /\((ERR_[A-Z0-9_]+)\)['"`]/g],
];

function sourceFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(js|jsx|mjs)$/.test(entry) && !/\.test\.js$/.test(entry)) acc.push(full);
  }
  return acc;
}

/**
 * Every raise site under packages/<pkg>/src.
 * @param {string} packagesDir
 * @returns {{ code: string, pkg: string, file: string, how: 'code' | 'report' | 'warning' | 'log' }[]}
 */
export function findRaiseSites(packagesDir) {
  const catalogueFile = join(packagesDir, 'core', 'src', 'errors.js');
  const sites = [];
  for (const pkgDir of readdirSync(packagesDir)) {
    let files;
    try { files = sourceFiles(join(packagesDir, pkgDir, 'src')); } catch { continue; }
    let pkg = pkgDir;
    try { pkg = JSON.parse(readFileSync(join(packagesDir, pkgDir, 'package.json'), 'utf8')).name || pkgDir; } catch { /* keep the directory name */ }
    for (const file of files) {
      let text = readFileSync(file, 'utf8');
      if (file === catalogueFile) text = text.slice(text.indexOf('// Reverse index'));
      for (const [how, re] of RAISE_SITES) {
        for (const [, code] of text.matchAll(re)) sites.push({ code, pkg, file, how });
      }
    }
  }
  return sites;
}
