// Reap smoke-app servers that outlived their run.
//
//   node smoke/clean.mjs          # report what is still listening
//   node smoke/clean.mjs --kill   # and stop it
//
// The runner starts app servers detached, on purpose: a dev server spawns
// children that outlive a bare child.kill() and keep holding the port. It kills
// the whole process group on exit, SIGINT and SIGTERM, which covers a normal run
// and a Ctrl-C. What it cannot cover is the parent being SIGKILLed, the machine
// sleeping mid-run, or a person running `npm run dev` in an app directory by
// hand and walking away. Those leak, and a leaked server is not harmless:
// assertPortFree refuses to start a run against a busy port, so the next smoke
// run fails with a message about a stale process rather than a real result.
//
// Found the honest way: five of these had been running for over a day before
// anyone noticed, including two holding ports in the runner's own range.
//
// Deliberately conservative. It only stops a process that is BOTH listening in
// the smoke port range AND working inside this repo or a what-smoke temp
// directory, because this machine also runs dev servers for unrelated projects
// and none of them are ours to kill.

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PORT_BASE = Number(process.env.WHAT_SMOKE_APP_PORT_BASE) || 4700;
const PORT_SPAN = 100;
const KILL = process.argv.includes('--kill');

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** PIDs listening on any port in the smoke range. */
function listeningPids() {
  const range = `${PORT_BASE}-${PORT_BASE + PORT_SPAN - 1}`;
  const out = sh('lsof', ['-nP', `-iTCP:${range}`, '-sTCP:LISTEN', '-Fpn']);
  const found = new Map(); // pid -> ports
  let pid = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1));
      if (!found.has(pid)) found.set(pid, new Set());
    } else if (line.startsWith('n') && pid) {
      const port = line.match(/:(\d+)$/);
      if (port) found.get(pid).add(Number(port[1]));
    }
  }
  return found;
}

function cwdOf(pid) {
  const out = sh('lsof', ['-p', String(pid), '-a', '-d', 'cwd', '-Fn']);
  const line = out.split('\n').find((l) => l.startsWith('n'));
  return line ? line.slice(1) : '';
}

/** Ours to stop: inside this repo, or in a runner temp directory. */
function isOurs(cwd) {
  if (!cwd) return false;
  return cwd.startsWith(REPO) || /what-smoke-apps-/.test(cwd);
}

const candidates = [];
for (const [pid, ports] of listeningPids()) {
  const cwd = cwdOf(pid);
  candidates.push({ pid, ports: [...ports].sort((a, b) => a - b), cwd, ours: isOurs(cwd) });
}

if (candidates.length === 0) {
  console.log(`[smoke-clean] nothing listening in ${PORT_BASE}-${PORT_BASE + PORT_SPAN - 1}`);
  process.exit(0);
}

let stopped = 0;
let skipped = 0;
for (const c of candidates) {
  const where = c.cwd.replace(REPO, '<repo>') || '(unknown cwd)';
  if (!c.ours) {
    skipped++;
    console.log(`[smoke-clean] SKIP  pid ${c.pid} on ${c.ports.join(',')}: not ours: ${where}`);
    continue;
  }
  if (!KILL) {
    console.log(`[smoke-clean] FOUND pid ${c.pid} on ${c.ports.join(',')}: ${where}`);
    continue;
  }
  // Process GROUP first: the runner spawns detached so the whole tree dies
  // together. A bare pid kill leaves the child that is actually holding the
  // port, which is the failure this script exists to clean up.
  try { process.kill(-c.pid, 'SIGTERM'); } catch { /* not a group leader */ }
  try { process.kill(c.pid, 'SIGTERM'); } catch { /* already gone */ }
  stopped++;
  console.log(`[smoke-clean] STOP  pid ${c.pid} on ${c.ports.join(',')}: ${where}`);
}

if (!KILL && stopped === 0 && candidates.some((c) => c.ours)) {
  console.log('[smoke-clean] re-run with --kill to stop them');
}
if (KILL) {
  console.log(`[smoke-clean] stopped ${stopped}${skipped ? `, skipped ${skipped} not ours` : ''}`);
}
