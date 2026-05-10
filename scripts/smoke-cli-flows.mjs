#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const workspace = mkdtempSync(join(tmpdir(), 'what-fw-cli-smoke-'));
const appDir = join(workspace, 'app');

try {
  createFixtureApp(appDir);

  console.log('[cli-smoke] Running what build');
  runWhat(['build'], appDir);
  assertFile(join(appDir, 'dist/main.js'));
  assertFile(join(appDir, 'dist/foo.txt'));

  rmSync(join(appDir, 'dist'), { recursive: true, force: true });
  console.log('[cli-smoke] Running what generate');
  runWhat(['generate'], appDir);
  assertFile(join(appDir, 'dist/main.js'));

  const devPort = await getFreePort();
  console.log('[cli-smoke] Starting what dev');
  const dev = startWhat(['dev', '--host', '127.0.0.1', '--port', String(devPort), '--no-mcp'], appDir);
  try {
    await waitForServer(`http://127.0.0.1:${devPort}/foo.txt`, dev);
    await expectText(`http://127.0.0.1:${devPort}/foo.txt`, 'hello from public');
    await expectIncludes(`http://127.0.0.1:${devPort}/main.js`, 'fixture-main');
  } finally {
    await stopProcess(dev);
  }

  const previewPort = await getFreePort();
  console.log('[cli-smoke] Starting what preview');
  const preview = startWhat(['preview', '--port', String(previewPort)], appDir);
  try {
    await waitForServer(`http://127.0.0.1:${previewPort}/foo.txt`, preview);
    await expectText(`http://127.0.0.1:${previewPort}/foo.txt`, 'hello from public');
    await expectIncludes(`http://127.0.0.1:${previewPort}/main.js`, 'fixture-main');
  } finally {
    await stopProcess(preview);
  }

  console.log('[cli-smoke] what CLI build/generate/dev/preview smoke passed');
} finally {
  if (process.env.KEEP_CLI_SMOKE_TMP) {
    console.log(`[cli-smoke] Kept temp directory: ${workspace}`);
  } else {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function createFixtureApp(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'public'), { recursive: true });
  writeFileSync(join(dir, 'what.config.js'), `export default { mode: 'client', outDir: 'dist', hash: false };\n`);
  writeFileSync(join(dir, 'src/index.html'), `<!doctype html><div id="app"></div><script type="module" src="/main.js"></script>\n`);
  writeFileSync(join(dir, 'src/main.js'), `console.log('fixture-main');\n`);
  writeFileSync(join(dir, 'public/foo.txt'), 'hello from public');
}

function whatCommand(args) {
  const bin = process.env.WHAT_CLI_BIN;
  if (bin) return { cmd: bin, args };
  return { cmd: process.execPath, args: [join(repoRoot, 'packages/cli/src/cli.js'), ...args] };
}

function runWhat(args, cwd) {
  const command = whatCommand(args);
  const result = spawnSync(command.cmd, command.args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`what ${args.join(' ')} failed with exit ${result.status}`);
  }
  return result;
}

function startWhat(args, cwd) {
  const command = whatCommand(args);
  const child = spawn(command.cmd, command.args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = '';
  child.stdout.on('data', chunk => { child.output += chunk; });
  child.stderr.on('data', chunk => { child.output += chunk; });
  return child;
}

function assertFile(path) {
  if (!existsSync(path)) throw new Error(`Expected file to exist: ${path}`);
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

async function waitForServer(url, child) {
  const deadline = Date.now() + 8000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with ${child.exitCode}: ${child.output}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'unknown error'}\n${child.output}`);
}

async function expectText(url, expected) {
  const response = await fetch(url);
  if (response.status !== 200) throw new Error(`${url} responded ${response.status}`);
  const actual = await response.text();
  if (actual !== expected) throw new Error(`${url} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function expectIncludes(url, expected) {
  const response = await fetch(url);
  if (response.status !== 200) throw new Error(`${url} responded ${response.status}`);
  const actual = await response.text();
  if (!actual.includes(expected)) throw new Error(`${url} did not include ${JSON.stringify(expected)}`);
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
