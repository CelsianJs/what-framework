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

// A spawned bridge is ready when it prints its pairing URL, which it does
// after both ports listen and the discovery file is written. The wait ends on
// that line, on the process exiting, or at a deadline just under the test's
// own timeout, so a loaded machine slows the test down instead of failing it.
const TEST_TIMEOUT = 60_000;
const DEADLINE = TEST_TIMEOUT - 5_000;

async function available(port, launched) {
  const { child } = launched;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`bridge did not listen within ${DEADLINE} ms; stderr: ${launched.stderr()}`)), DEADLINE);
    const onData = () => { if (launched.stderr().includes('Pairing on http://')) done(); };
    const onExit = (code, signal) => done(new Error(`bridge exited (${code ?? signal}) before listening; stderr: ${launched.stderr()}`));
    function done(error) {
      clearTimeout(timer);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
      if (error) reject(error); else resolve();
    }
    child.stderr.on('data', onData);
    child.once('exit', onExit);
    onData();
  });
  const reply = await fetch(`http://127.0.0.1:${port + 1}/__what_mcp_probe`);
  assert.equal((await reply.json()).wsPort, port);
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

test('stdio EOF frees both bridge ports and removes its discovery file', { timeout: TEST_TIMEOUT }, async (t) => {
  const { launch, port, file } = await workspace(t);
  const first = launch();
  await available(port, first);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, first.child.pid);
  first.child.stdin.end();
  assert.deepEqual(await first.exited, [0, null]);
  assert.throws(() => readFileSync(file), { code: 'ENOENT' });
  const second = launch();
  await available(port, second);
  second.child.stdin.end();
  assert.deepEqual(await second.exited, [0, null]);
});

test('a port collision points to the existing What session and preserves its discovery', { timeout: TEST_TIMEOUT }, async (t) => {
  const { launch, port, file } = await workspace(t);
  const first = launch();
  await available(port, first);
  const second = launch();
  assert.deepEqual(await second.exited, [1, null]);
  assert.match(second.stderr(), new RegExp(`What MCP PID ${first.child.pid}`));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, first.child.pid);
  first.child.stdin.end();
  await first.exited;
});

test('the bridge closes on parent loss even with stdin still open', { timeout: TEST_TIMEOUT }, async (t) => {
  const { launch, port, file } = await workspace(t);
  const parent = launch(['--input-type=module', '-e', `
    import { spawn } from 'node:child_process';
    spawn(process.execPath, [${JSON.stringify(bin)}], { stdio: [3, 'inherit', 'inherit'] }).unref();
    setInterval(() => {}, 1000);
  `]);
  await available(port, parent);
  const { pid } = JSON.parse(readFileSync(file, 'utf8'));
  t.after(() => { try { process.kill(pid, 'SIGTERM'); } catch { /* exited */ } });
  parent.child.kill('SIGTERM');
  assert.deepEqual(await parent.exited, [null, 'SIGTERM']);
  assert.equal(parent.child.stdio[3].destroyed, false);
  // The outer test still holds the write end while the bridge detects
  // reparenting, so stdin EOF cannot be the shutdown trigger.
  for (const end = Date.now() + DEADLINE - 5_000; Date.now() < end;) {
    try { readFileSync(file); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    await tick();
  }
  assert.fail('orphaned bridge still owns its discovery file');
});
