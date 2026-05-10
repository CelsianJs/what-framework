import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('create-what exposes non-mutating CLI help and version', () => {
  const help = execFileSync(process.execPath, ['packages/create-what/index.js', '--help'], { encoding: 'utf8' });
  assert.match(help, /Usage:/);
  assert.match(help, /--yes/);

  const version = execFileSync(process.execPath, ['packages/create-what/index.js', '--version'], { encoding: 'utf8' }).trim();
  assert.equal(version, '0.6.2');
});
