#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const failures = [];
const secretPattern = /(GODADDY|NPM_TOKEN|VERCEL_TOKEN|OPENROUTER|API_SECRET|API_KEY)\s*=\s*[^\s#][^\n]*(?!example|placeholder|your-)/i;

function isEnvFile(path) {
  const name = path.split('/').pop() || '';
  return name === '.env' || name.startsWith('.env.');
}

function isAllowedEnvExample(path) {
  return path.endsWith('.env.example') || path.endsWith('.env.sample') || path.endsWith('.env.template');
}

function shouldSkipDir(entry) {
  return entry === 'node_modules' || entry === 'dist' || entry === 'coverage' || entry.startsWith('.git');
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (shouldSkipDir(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }

    const envFile = isEnvFile(full);
    const lintableText = envFile || /\.(js|mjs|jsx|json|md|yml|yaml)$/.test(entry);
    if (envFile && !isAllowedEnvExample(full)) {
      failures.push(`${full} is a local env file; remove it before release.`);
    }
    if (lintableText) {
      const text = readFileSync(full, 'utf8');
      if (secretPattern.test(text) && !isAllowedEnvExample(full)) failures.push(`${full} contains live-looking secret material.`);
      if (/^(packages|scripts|\.github)\//.test(full) && /\.(js|mjs|jsx|json|md|yml|yaml)$/.test(entry) && /[ \t]+$/m.test(text)) failures.push(`${full} has trailing whitespace.`);
    }
  }
}
walk('.');

if (failures.length) {
  for (const failure of failures) console.error(`lint: ${failure}`);
  process.exit(1);
}
console.log('Lint checks passed.');
