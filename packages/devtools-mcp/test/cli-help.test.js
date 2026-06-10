// T3-03 (sprint/audit-fixes-2026-06-09): `what-devtools-mcp --help` used to
// start the WS bridge + discovery server and block on the MCP stdio transport
// forever. The flag must print usage and exit 0 BEFORE any server starts.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BIN = new URL('../src/index.js', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

function run(args) {
  // Generous timeout, but far below the test runner's: a hang here means the
  // regression is back (bin started its servers instead of exiting).
  return spawnSync(process.execPath, [BIN, ...args], { timeout: 10_000, encoding: 'utf8' });
}

describe('what-devtools-mcp CLI flags', () => {
  for (const flag of ['--help', '-h']) {
    it(`${flag} prints usage and exits 0 without starting servers`, () => {
      const r = run([flag]);
      assert.equal(r.signal, null, 'must exit on its own (not be killed by the timeout)');
      assert.equal(r.status, 0);
      assert.match(r.stdout, /Usage:/);
      assert.match(r.stdout, /what-devtools-mcp/);
      assert.match(r.stdout, /--unsafe-eval/);
      assert.match(r.stdout, /WHAT_MCP_PORT/);
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
});
