#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const failures = [];
if (existsSync('.env')) failures.push('Local .env exists in release workspace; remove it before release.');

const secretPattern = /(GODADDY|NPM_TOKEN|VERCEL_TOKEN|API_SECRET|API_KEY)\s*=\s*[^\s#][^\n]*(?!example|placeholder|your-)/i;
for (const file of ['.env', '.env.local']) {
  if (existsSync(file) && secretPattern.test(readFileSync(file, 'utf8'))) failures.push(`${file} contains live-looking secret material.`);
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage' || entry.startsWith('.git')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (/\.(js|mjs|jsx|json|md|yml|yaml)$/.test(entry)) {
      const text = readFileSync(full, 'utf8');
      if (/[ \t]+$/m.test(text)) failures.push(`${full} has trailing whitespace.`);
    }
  }
}
for (const dir of ['packages', 'scripts', '.github']) if (existsSync(dir)) walk(dir);

if (failures.length) {
  for (const failure of failures) console.error(`lint: ${failure}`);
  process.exit(1);
}
console.log('Lint checks passed.');
