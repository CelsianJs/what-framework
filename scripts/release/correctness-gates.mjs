#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// One ordering contract for local verification and the publisher. Pack checks
// run again after building; app smokes then consume those fresh artifacts.
export const CORRECTNESS_GATES = [
  'hygiene:publish', 'test', 'build', 'hygiene:publish', 'hygiene:types',
  'check:error-codes', 'check:error-docs', 'typecheck', 'typecheck:src', 'lint',
  'check:size', 'test:prod', 'smoke:scaffold', 'smoke:apps',
];

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function runReleaseGates({ includeBench = false, run = runGate } = {}) {
  const gates = [...CORRECTNESS_GATES];
  if (includeBench) gates.splice(gates.indexOf('smoke:scaffold'), 0, 'bench:gate');
  for (const gate of gates) {
    if (run(gate) !== 0) throw new Error(`Release gate failed: ${gate}`);
  }
}

function runGate(gate) {
  console.log(`[release-verify] ${gate}`);
  const result = spawnSync('npm', ['run', '-s', gate], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--with-bench')) {
    console.error('Usage: node scripts/release/correctness-gates.mjs [--with-bench]');
    process.exit(1);
  }
  try {
    runReleaseGates({ includeBench: args.includes('--with-bench') });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
