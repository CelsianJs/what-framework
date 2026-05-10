#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const forbidden = [
  /^test-results\//,
  /^examples\/[^/]+\/test-results\//,
];

const res = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
if (res.status !== 0) {
  process.stderr.write(res.stderr || 'git ls-files failed\n');
  process.exit(res.status || 1);
}

const offenders = res.stdout.split(/\r?\n/).filter(Boolean).filter((file) => forbidden.some((pattern) => pattern.test(file)));
if (offenders.length > 0) {
  console.error('Playwright/test artifacts are tracked:');
  for (const file of offenders) console.error(`  - ${file}`);
  process.exit(1);
}

console.log('OK: no tracked Playwright/test-result artifacts.');
