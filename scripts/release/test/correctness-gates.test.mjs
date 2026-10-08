import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');
const expected = ['hygiene:publish', 'test', 'build', 'hygiene:publish', 'hygiene:types', 'check:error-codes', 'check:error-docs', 'typecheck', 'typecheck:src', 'lint', 'check:size', 'test:prod', 'smoke:scaffold', 'smoke:apps'];

test('the shared release gate list builds before final pack/type/production checks', async () => {
  const { runReleaseGates } = await import('../correctness-gates.mjs');
  const calls = [];
  runReleaseGates({ run: gate => { calls.push(gate); return 0; } });
  assert.deepEqual(calls, expected);
});

test('local release verification retains a strict benchmark before app smokes', async () => {
  const { runReleaseGates } = await import('../correctness-gates.mjs');
  const calls = [];
  runReleaseGates({ includeBench: true, run: gate => { calls.push(gate); return 0; } });
  const local = [...expected]; local.splice(local.indexOf('smoke:scaffold'), 0, 'bench:gate');
  assert.deepEqual(calls, local);
  assert.throws(() => runReleaseGates({ includeBench: true, run: gate => gate === 'bench:gate' ? 1 : 0 }), /bench:gate/);
});

test('each formerly omitted correctness gate stops the release on failure', async () => {
  const { runReleaseGates } = await import('../correctness-gates.mjs');
  for (const failing of ['hygiene:types', 'check:error-codes', 'check:error-docs', 'typecheck', 'typecheck:src', 'lint']) {
    const calls = [];
    assert.throws(() => runReleaseGates({ run: gate => { calls.push(gate); return gate === failing ? 1 : 0; } }), new RegExp(failing));
    assert.equal(calls.at(-1), failing);
  }
});

test('local and publisher entry points use the shared gate runner, not copied lists', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json')));
  const workflow = readFileSync(resolve(root, '.github/workflows/release-and-deploy.yml'), 'utf8');
  assert.equal(pkg.scripts['release:verify'], 'node scripts/release/correctness-gates.mjs --with-bench');
  assert.equal(pkg.scripts['release:verify:correctness'], 'node scripts/release/correctness-gates.mjs');
  assert.match(workflow, /run: npm run -s release:verify:correctness/);
  assert.match(workflow, /continue-on-error: true[\s\S]*run: npm run -s bench:gate/);
});

test('the executable runner dispatches npm gates from the repository and propagates failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-gates-'));
  try {
    const log = join(dir, 'calls.jsonl');
    const npm = join(dir, 'npm');
    writeFileSync(npm, `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.appendFileSync(process.env.MOCK_GATE_LOG, JSON.stringify({cwd: process.cwd(), args: process.argv.slice(2)}) + '\\n');\nif (process.argv.at(-1) === process.env.MOCK_GATE_FAIL) process.exit(1);\n`);
    chmodSync(npm, 0o755);
    for (const failing of ['', 'typecheck']) {
      writeFileSync(log, '');
      const result = spawnSync(process.execPath, [join(root, 'scripts/release/correctness-gates.mjs')], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, MOCK_GATE_LOG: log, MOCK_GATE_FAIL: failing },
      });
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(result.status, failing ? 1 : 0, result.stderr);
      assert.ok(calls.every(call => call.cwd === root));
      assert.deepEqual(calls.map(call => call.args), (failing ? expected.slice(0, expected.indexOf(failing) + 1) : expected).map(gate => ['run', '-s', gate]));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
