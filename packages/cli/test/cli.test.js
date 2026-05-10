import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const cliPath = join(repoRoot, 'packages/cli/src/cli.js');

let appDir;

describe('what CLI flows', () => {
  beforeEach(() => {
    appDir = mkdtempSync(join(tmpdir(), 'what-cli-test-'));
    createFixtureApp(appDir);
  });

  afterEach(() => {
    rmSync(appDir, { recursive: true, force: true });
  });

  it('runs help without triggering command dispatch crashes', () => {
    const result = runCli([], appDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /what - The closest framework/);
  });

  it('builds and generates a fixture app', () => {
    const build = runCli(['build'], appDir);
    assert.equal(build.status, 0, build.stderr || build.stdout);
    assert.ok(existsSync(join(appDir, 'dist/main.js')), 'build should emit main.js');
    assert.ok(existsSync(join(appDir, 'dist/foo.txt')), 'build should copy public asset');

    rmSync(join(appDir, 'dist'), { recursive: true, force: true });
    const generate = runCli(['generate'], appDir);
    assert.equal(generate.status, 0, generate.stderr || generate.stdout);
    assert.ok(existsSync(join(appDir, 'dist/main.js')), 'generate should perform a build');
  });

  it('serves public and source URL paths in dev', async () => {
    const port = await getFreePort();
    const child = startCli(['dev', '--host', '127.0.0.1', '--port', String(port), '--no-mcp'], appDir);
    try {
      await waitForServer(`http://127.0.0.1:${port}/foo.txt`);
      assert.equal(await text(`http://127.0.0.1:${port}/foo.txt`), 'hello from public');
      assert.match(await text(`http://127.0.0.1:${port}/main.js`), /fixture-main/);
    } finally {
      await stopProcess(child);
    }
  });

  it('serves built assets in preview', async () => {
    const build = runCli(['build'], appDir);
    assert.equal(build.status, 0, build.stderr || build.stdout);

    const port = await getFreePort();
    const child = startCli(['preview', '--port', String(port)], appDir);
    try {
      await waitForServer(`http://127.0.0.1:${port}/foo.txt`);
      assert.equal(await text(`http://127.0.0.1:${port}/foo.txt`), 'hello from public');
      assert.match(await text(`http://127.0.0.1:${port}/main.js`), /fixture-main/);
    } finally {
      await stopProcess(child);
    }
  });
});

function createFixtureApp(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'public'), { recursive: true });
  writeFileSync(join(dir, 'what.config.js'), `export default { mode: 'client', outDir: 'dist', hash: false };\n`);
  writeFileSync(join(dir, 'src/index.html'), `<!doctype html><div id="app"></div><script type="module" src="/main.js"></script>\n`);
  writeFileSync(join(dir, 'src/main.js'), `console.log('fixture-main');\n`);
  writeFileSync(join(dir, 'public/foo.txt'), 'hello from public');
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
}

function startCli(args, cwd) {
  const child = spawn(process.execPath, [cliPath, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = '';
  child.stdout.on('data', chunk => { child.output += chunk; });
  child.stderr.on('data', chunk => { child.output += chunk; });
  return child;
}

async function getFreePort() {
  const { createServer } = await import('node:http');
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function text(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200, `${url} should respond 200`);
  return response.text();
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 1000)),
  ]);
}
