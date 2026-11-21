// Every way a package raises a code is a raise site: the generated docs say how
// each code reaches you from these, so a form the scanner misses shows up in
// skills/what-diagnostics/SKILL.md as "no detector yet".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findRaiseSites } from '../error-raise-sites.mjs';

const root = resolve(import.meta.dirname, '../../..');
const sites = findRaiseSites(join(root, 'packages'));

test('a logged line that ends with the code is a raise site of the package that logs it', () => {
  const site = sites.find((s) => s.code === 'ERR_SSR_UNSAFE_REDIRECT');
  assert.ok(site, 'what-server logs ERR_SSR_UNSAFE_REDIRECT');
  assert.equal(site.pkg, 'what-server');
  assert.equal(site.how, 'log');
});

test('the shipped catalogue says how a logged code reaches you', () => {
  const { codes } = JSON.parse(readFileSync(join(root, 'packages/what/diagnostics.json'), 'utf8'));
  for (const code of ['ERR_SSR_UNSAFE_REDIRECT', 'ERR_SSR_LATE_HEAD']) {
    assert.deepEqual(codes.find((c) => c.code === code).detects, ['server'], code);
  }
});
