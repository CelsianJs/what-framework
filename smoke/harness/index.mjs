// Shared primitives for the app smoke suite.
//
// The suite exists because of a specific failure: 0.12.0 and 0.12.1 shipped a
// what-server packaging defect that every workspace test passed straight
// through. It was only visible to something that INSTALLED the published
// artifact and used it. So the defining feature here is `resolvePackageSource`:
// the same apps run against local tarballs (pre-release regression) or against
// the real registry (post-release verification).

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Workspace dir -> published package name. Everything an app can reach,
// directly or transitively, so npm never silently falls back to the registry
// when we asked for workspace code.
export const WORKSPACE_PACKAGES = {
  'packages/what': 'what-framework',
  'packages/core': 'what-core',
  'packages/router': 'what-router',
  'packages/server': 'what-server',
  'packages/compiler': 'what-compiler',
  'packages/cache': 'what-isr',
  'packages/devtools': 'what-devtools',
  'packages/devtools-mcp': 'what-devtools-mcp',
  'packages/eslint-plugin': 'eslint-plugin-what',
};

const children = new Set();

export function killAllChildren() {
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    try { child.kill('SIGKILL'); } catch {}
  }
  children.clear();
}

process.on('exit', killAllChildren);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { killAllChildren(); process.exit(1); });
}

export function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...opts,
  });
}

export function startProcess(cmd, args, opts = {}) {
  // detached so we can kill the whole process group: dev servers spawn
  // children that outlive a bare child.kill() and then hold the port.
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...opts });
  child.logs = '';
  child.stdout?.on('data', (d) => { child.logs += d; });
  child.stderr?.on('data', (d) => { child.logs += d; });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

/**
 * A stale process answering on our port makes every downstream assertion lie,
 * because it is serving a DIFFERENT app. Refuse to start rather than report
 * someone else's passing results as ours.
 */
export async function assertPortFree(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
  } catch {
    return;
  }
  throw new Error(
    `port ${port} is already in use; kill the stale process first.\n` +
    `  npm run smoke:ports     # what is holding it\n` +
    `  npm run smoke:clean     # stop the ones that are ours\n` +
    `A server SIGKILLed mid-run, or started by hand with npm run dev, survives ` +
    `the group kill this harness does on exit.`,
  );
}

export async function waitForHttp(url, { timeoutMs = 60000, child } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`process exited (${child.exitCode}) before ${url} was up:\n${child.logs}`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return res;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${url}${child ? `\n--- logs ---\n${child.logs}` : ''}`);
}

/**
 * Resolve where the app's what-* dependencies come from.
 *
 *   workspace -> `npm pack` each workspace package, install the tarballs.
 *                Catches source regressions before a release exists.
 *   npm       -> install `name@version` straight from the registry.
 *                Catches PACKAGING defects: a types path that is declared but
 *                not published, an export condition shadowed by another, a
 *                dependency that only resolves inside the monorepo. Workspace
 *                mode is blind to every one of those by construction.
 */
export function resolvePackageSource({ source, version, repoRoot, tarballDir, log = () => {} }) {
  if (source === 'npm') {
    const specs = {};
    for (const name of Object.values(WORKSPACE_PACKAGES)) specs[name] = `${version}`;
    log(`resolving what-* from the npm registry at ${version}`);
    return { kind: 'npm', specs };
  }

  mkdirSync(tarballDir, { recursive: true });
  const specs = {};
  for (const [dir, name] of Object.entries(WORKSPACE_PACKAGES)) {
    const out = run('npm', ['pack', join(repoRoot, dir), '--pack-destination', tarballDir, '--silent']);
    const file = out.trim().split('\n').pop();
    const tarball = join(tarballDir, file);
    if (!existsSync(tarball)) throw new Error(`npm pack of ${name} did not produce ${file}`);
    specs[name] = `file:${tarball}`;
  }
  log(`packed ${Object.keys(specs).length} workspace packages`);
  return { kind: 'workspace', specs };
}

/**
 * Point every what-* dependency at the resolved source. `overrides` covers the
 * transitive graph (what-framework -> what-core/router/server/compiler) so a
 * stale registry copy can never sneak into a workspace run, which would make
 * the run silently meaningless.
 */
export function applyPackageSource(appDir, specs) {
  const pkgPath = join(appDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  for (const section of ['dependencies', 'devDependencies']) {
    for (const dep of Object.keys(pkg[section] || {})) {
      if (specs[dep]) pkg[section][dep] = specs[dep];
    }
  }
  pkg.overrides = { ...pkg.overrides, ...specs };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  return pkg;
}

/**
 * Assert the installed tree really came from the source we asked for. Without
 * this, a resolution fallback turns a green run into a lie about which bytes
 * were tested.
 */
export function verifyInstalledSource(appDir, { kind, version }) {
  const problems = [];
  for (const name of Object.values(WORKSPACE_PACKAGES)) {
    const manifest = join(appDir, 'node_modules', name, 'package.json');
    if (!existsSync(manifest)) continue; // not every app uses every package
    const installed = JSON.parse(readFileSync(manifest, 'utf8'));
    if (kind === 'npm' && installed.version !== version) {
      problems.push(`${name} is ${installed.version}, expected ${version} from the registry`);
    }
  }
  if (problems.length) throw new Error(`installed tree does not match the requested source:\n  ${problems.join('\n  ')}`);
}

export async function launchBrowser({ required = true } = {}) {
  try {
    const { chromium } = await import('playwright');
    return await chromium.launch();
  } catch (err) {
    if (required) {
      throw new Error(
        `Chromium failed to launch: ${err.message.split('\n')[0]}\n` +
        'Every check in this suite is browser-driven, so there is no meaningful ' +
        'degraded mode: run `npx playwright install chromium`.',
      );
    }
    return null;
  }
}

/**
 * Open a page and collect everything that went wrong on it. Nothing is thrown:
 * a check asserts on the collection, because "it rendered" and "it rendered
 * without complaining" are different claims and the second one is the one that
 * catches hydration mismatches.
 *
 * Warnings are kept separately from errors on purpose. A hydration mismatch is
 * a console WARNING, so a collector that only watched errors would report a
 * clean page while the client was silently throwing away the server's DOM.
 */
export async function withPage(browser, url, fn, { context } = {}) {
  const page = context ? await context.newPage() : await browser.newPage();
  const diag = { errors: [], warnings: [], all: [] };
  page.on('pageerror', (e) => {
    diag.errors.push(`pageerror: ${e.message}`);
    diag.all.push(`pageerror: ${e.message}`);
  });
  page.on('console', (m) => {
    const line = `${m.type()}: ${m.text()}`;
    diag.all.push(line);
    if (m.type() === 'error') diag.errors.push(line);
    else if (m.type() === 'warning') diag.warnings.push(line);
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    return await fn(page, diag);
  } finally {
    await page.close();
  }
}

/** Collector so one app's failure does not hide the rest of its checks. */
export function createReporter(appName) {
  const results = [];
  return {
    results,
    ok(name, detail = '') {
      results.push({ app: appName, name, passed: true, detail });
      console.log(`    ok   ${name}${detail ? ` (${detail})` : ''}`);
    },
    fail(name, detail = '') {
      results.push({ app: appName, name, passed: false, detail });
      console.log(`    FAIL ${name}${detail ? `: ${detail}` : ''}`);
    },
    assert(cond, name, detail = '') {
      if (cond) this.ok(name, detail);
      else this.fail(name, detail);
      return !!cond;
    },
    get failures() { return results.filter((r) => !r.passed); },
  };
}
