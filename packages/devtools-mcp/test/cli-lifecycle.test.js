import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freePortPair } from './helpers/fake-page.js';
import { BRIDGE_FILE } from '../src/bridge.js';

const bin = fileURLToPath(new URL('../src/index.js', import.meta.url));
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

async function available(port, child) {
  for (let tries = 0; tries < 120; tries++) {
    try {
      const reply = await fetch(`http://127.0.0.1:${port + 1}/__what_mcp_probe`);
      if ((await reply.json()).wsPort === port) return;
    } catch { /* still binding */ }
    assert.equal(child.exitCode, null);
    await tick();
  }
  assert.fail('bridge did not listen');
}

async function workspace(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'what-mcp-stdio-'));
  const port = await freePortPair();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...process.env, WHAT_MCP_PORT: String(port) };
  function launch(args = [bin]) {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data; });
    t.after(() => child.kill());
    return { child, exited: once(child, 'exit'), stderr: () => stderr };
  }
  return { launch, port, file: join(cwd, BRIDGE_FILE) };
}

test('stdio EOF frees both bridge ports and removes its discovery file', { timeout: 8000 }, async (t) => {
  const { launch, port, file } = await workspace(t);
  const first = launch();
  await available(port, first.child);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, first.child.pid);
  first.child.stdin.end();
  assert.deepEqual(await first.exited, [0, null]);
  assert.throws(() => readFileSync(file), { code: 'ENOENT' });
  const second = launch();
  await available(port, second.child);
  second.child.stdin.end();
  assert.deepEqual(await second.exited, [0, null]);
});

test('a port collision points to the existing What session and preserves its discovery', { timeout: 8000 }, async (t) => {
  const { launch, port, file } = await workspace(t);
  const first = launch();
  await available(port, first.child);
  const second = launch();
  assert.deepEqual(await second.exited, [1, null]);
  assert.match(second.stderr(), new RegExp(`What MCP PID ${first.child.pid}`));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, first.child.pid);
  first.child.stdin.end();
  await first.exited;
});

test('the bridge closes on parent loss even with stdin still open', { timeout: 8000 }, async (t) => {
  const { launch, port, file } = await workspace(t);
  const parent = launch(['--input-type=module', '-e', `
    import { spawn } from 'node:child_process';
    spawn(process.execPath, [${JSON.stringify(bin)}], { stdio: [3, 'inherit', 'inherit'] }).unref();
    setInterval(() => {}, 1000);
  `]);
  await available(port, parent.child);
  const { pid } = JSON.parse(readFileSync(file, 'utf8'));
  t.after(() => { try { process.kill(pid, 'SIGTERM'); } catch { /* exited */ } });
  parent.child.kill('SIGTERM');
  assert.deepEqual(await parent.exited, [null, 'SIGTERM']);
  assert.equal(parent.child.stdio[3].destroyed, false);
  // The outer test still holds the write end while the bridge detects
  // reparenting, so stdin EOF cannot be the shutdown trigger.
  for (let tries = 0; tries < 100; tries++) {
    try { readFileSync(file); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    await tick();
  }
  assert.fail('orphaned bridge still owns its discovery file');
});
