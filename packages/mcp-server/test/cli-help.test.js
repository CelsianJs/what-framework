// T3-03 (sprint/audit-fixes-2026-06-09): `what-mcp --help` used to ignore the
// flag and block on the MCP stdio transport. It must print usage and exit 0
// before connecting, and the Server init must report the real package version
// (was hardcoded '0.1.0').

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BIN = new URL('../src/index.js', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { timeout: 10_000, encoding: 'utf8' });
}

describe('what-mcp CLI flags', () => {
  for (const flag of ['--help', '-h']) {
    it(`${flag} prints usage and exits 0 without starting the stdio server`, () => {
      const r = run([flag]);
      assert.equal(r.signal, null, 'must exit on its own (not be killed by the timeout)');
      assert.equal(r.status, 0);
      assert.match(r.stdout, /Usage:/);
      assert.match(r.stdout, /what-mcp/);
      assert.match(r.stdout, /DEPRECATED/);
    });
  }

  for (const flag of ['--version', '-v']) {
    it(`${flag} prints the package.json version and exits 0`, () => {
      const r = run([flag]);
      assert.equal(r.signal, null);
      assert.equal(r.status, 0);
      assert.equal(r.stdout.trim(), pkg.version);
    });
  }

  it('source no longer hardcodes version 0.1.0 in the Server init', () => {
    const src = readFileSync(BIN, 'utf-8');
    assert.ok(!src.includes("version: '0.1.0'"), 'Server init must read version from package.json');
    assert.match(src, /version:\s*pkg\.version/);
  });
});
