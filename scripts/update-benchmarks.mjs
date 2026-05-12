#!/usr/bin/env node

// Runs benchmark/run.js, reads JSON output, and regenerates
// sites/benchmarks/index.html with fresh data + a "Last updated" timestamp.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const jsonPath = resolve(repoRoot, 'sites/benchmarks/results.json');
const htmlPath = resolve(repoRoot, 'sites/benchmarks/index.html');

const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'packages/core/package.json'), 'utf8'));
const version = pkg.version;

console.log(`[bench] Running benchmarks for what-framework v${version}...`);
execSync(`node benchmark/run.js --json "${jsonPath}"`, { cwd: repoRoot, stdio: 'inherit' });

const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
const results = data.results;

function find(name) {
  return results.find((r) => r.name === name);
}

function fmtOps(ops) {
  if (ops >= 1_000_000) return `${(ops / 1_000_000).toFixed(1)}M ops/sec`;
  if (ops >= 1_000) return `${Math.round(ops / 1_000)}K ops/sec`;
  return `${ops} ops/sec`;
}

function fmtTime(ms) {
  if (ms < 0.001) return `${(ms * 1000).toFixed(1)}µs`;
  return `${ms.toFixed(4)}ms`;
}

function row(name, displayName) {
  const r = find(name);
  if (!r) return '';
  const label = displayName || name;
  return `          <tr>
            <td>${label}</td>
            <td class="value">${fmtOps(r.opsPerSec)}</td>
            <td class="value">${fmtTime(r.avg)}</td>
          </tr>`;
}

function bundleRow() {
  return `          <tr>
            <td>what-framework (core)</td>
            <td class="value">~4kB</td>
          </tr>`;
}

const now = new Date();
const dateStr = now.toLocaleDateString('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});
const isoDate = now.toISOString();

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Benchmarks — What Framework</title>
  <meta name="description" content="Performance benchmarks for What Framework's signals, rendering, and SSR.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --text: #18181b;
      --text-secondary: #52525b;
      --text-muted: #a1a1aa;
      --bg: #fafafa;
      --bg-alt: #ffffff;
      --accent: #18181b;
      --border: #e4e4e7;
      --code-bg: #f4f4f5;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { font-size: 16px; }

    body {
      font-family: 'Inter', -apple-system, sans-serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.6;
    }

    nav {
      padding: 16px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      background: var(--bg-alt);
    }

    .logo {
      font-weight: 700;
      font-size: 18px;
      text-decoration: none;
      color: var(--text);
    }

    .nav-links {
      display: flex;
      gap: 24px;
    }

    .nav-links a {
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
    }

    .nav-links a:hover { color: var(--text); }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 48px 32px;
    }

    h1 {
      font-size: 36px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
    }

    .subtitle {
      font-size: 18px;
      color: var(--text-secondary);
      margin-bottom: 8px;
      max-width: 600px;
    }

    .last-updated {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 48px;
    }

    .last-updated time {
      font-weight: 500;
    }

    .benchmark-section {
      margin-bottom: 48px;
    }

    .benchmark-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 16px;
    }

    .benchmark-table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-alt);
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
    }

    .benchmark-table th,
    .benchmark-table td {
      padding: 14px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    .benchmark-table th {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      background: var(--bg);
    }

    .benchmark-table tr:last-child td {
      border-bottom: none;
    }

    .benchmark-table td:first-child {
      font-weight: 500;
    }

    .value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
    }

    .note {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 12px;
    }

    .methodology {
      margin-top: 48px;
      padding: 24px;
      background: var(--bg-alt);
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    .methodology h2 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 12px;
    }

    .methodology p {
      font-size: 14px;
      color: var(--text-secondary);
      margin-bottom: 12px;
    }

    .methodology p:last-child {
      margin-bottom: 0;
    }

    .methodology code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 4px;
    }

    footer {
      padding: 24px 32px;
      border-top: 1px solid var(--border);
      text-align: center;
      font-size: 14px;
      color: var(--text-secondary);
    }

    footer a {
      color: var(--text);
      text-decoration: none;
    }

    @media (max-width: 768px) {
      .nav-links { display: none; }
      .container { padding: 32px 24px; }
    }
  </style>
</head>
<body>
  <nav>
    <a href="https://whatfw.com" class="logo">What</a>
    <div class="nav-links">
      <a href="https://whatfw.com/docs">Docs</a>
      <a href="https://react.whatfw.com">React Compat</a>
      <a href="https://www.npmjs.com/package/what-framework">npm</a>
      <a href="https://github.com/CelsianJs/what-framework">GitHub</a>
    </div>
  </nav>

  <div class="container">
    <h1>Performance Benchmarks</h1>
    <p class="subtitle">Real measured performance data from the What Framework test suite. All benchmarks run on Node.js ${data.node}.</p>
    <p class="last-updated">Last updated <time datetime="${isoDate}">${dateStr}</time> · v${version} · ${data.platform}</p>

    <!-- Signals -->
    <div class="benchmark-section">
      <h2 class="benchmark-title">Signals</h2>
      <table class="benchmark-table">
        <thead>
          <tr>
            <th>Operation</th>
            <th>Ops/Second</th>
            <th>Time per Op</th>
          </tr>
        </thead>
        <tbody>
${row('signal() create', 'Signal create')}
${row('signal() read', 'Signal read (100x per iteration)')}
${row('signal() write (no subscribers)', 'Signal write (no subscribers)')}
${row('signal() write (1 subscriber)', 'Signal write (1 subscriber)')}
${row('signal() write (10 subscribers)', 'Signal write (10 subscribers)')}
${row('signal.peek()', 'Signal peek (untracked read)')}
        </tbody>
      </table>
      <p class="note">Subscriber overhead is expected — effects run on every write.</p>
    </div>

    <!-- Computed -->
    <div class="benchmark-section">
      <h2 class="benchmark-title">Computed Values</h2>
      <table class="benchmark-table">
        <thead>
          <tr>
            <th>Operation</th>
            <th>Ops/Second</th>
            <th>Time per Op</th>
          </tr>
        </thead>
        <tbody>
${row('computed() create + read', 'Computed create + read')}
${row('computed() chain (depth 5)', 'Computed chain (depth 5)')}
${row('computed() diamond dependency', 'Computed diamond dependency')}
        </tbody>
      </table>
    </div>

    <!-- Effects -->
    <div class="benchmark-section">
      <h2 class="benchmark-title">Effects</h2>
      <table class="benchmark-table">
        <thead>
          <tr>
            <th>Operation</th>
            <th>Ops/Second</th>
            <th>Time per Op</th>
          </tr>
        </thead>
        <tbody>
${row('effect() create + dispose', 'Effect create + dispose')}
${row('effect() with 10 signal deps', 'Effect with 10 signal deps')}
        </tbody>
      </table>
    </div>

    <!-- Batch -->
    <div class="benchmark-section">
      <h2 class="benchmark-title">Batching</h2>
      <table class="benchmark-table">
        <thead>
          <tr>
            <th>Operation</th>
            <th>Ops/Second</th>
            <th>Time per Op</th>
          </tr>
        </thead>
        <tbody>
${row('batch() 100 writes, 1 effect', 'Batch 100 writes, 1 effect')}
${row('batch() 10 signals, 10 writes each', 'Batch 10 signals, 10 writes each')}
        </tbody>
      </table>
      <p class="note">Batching prevents intermediate computations, making 100 writes nearly as fast as 1.</p>
    </div>

    <!-- Rendering -->
    <div class="benchmark-section">
      <h2 class="benchmark-title">Rendering (h function)</h2>
      <table class="benchmark-table">
        <thead>
          <tr>
            <th>Operation</th>
            <th>Ops/Second</th>
            <th>Time per Op</th>
          </tr>
        </thead>
        <tbody>
${row('h() element', 'Single element creation')}
${row('h() nested (3 levels)', 'Nested (3 levels)')}
${row('h() list of 100 items', 'List of 100 items')}
${row('h() component call', 'Component call')}
        </tbody>
      </table>
    </div>

    <!-- SSR -->
    <div class="benchmark-section">
      <h2 class="benchmark-title">Server-Side Rendering</h2>
      <table class="benchmark-table">
        <thead>
          <tr>
            <th>Operation</th>
            <th>Ops/Second</th>
            <th>Time per Op</th>
          </tr>
        </thead>
        <tbody>
${row('renderToString() simple', 'SSR simple element')}
${row('renderToString() nested', 'SSR nested tree')}
${row('renderToString() list of 100', 'SSR list of 100 items')}
${row('renderToString() component tree', 'SSR component tree (50 items)')}
        </tbody>
      </table>
    </div>

    <!-- Bundle Size -->
    <div class="benchmark-section">
      <h2 class="benchmark-title">Bundle Size</h2>
      <table class="benchmark-table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Size (gzipped)</th>
          </tr>
        </thead>
        <tbody>
${bundleRow()}
        </tbody>
      </table>
      <p class="note">Measured using gzip -9 compression.</p>
    </div>

    <!-- Methodology -->
    <div class="methodology">
      <h2>Methodology</h2>
      <p>All benchmarks run on Node.js ${data.node} with the following approach:</p>
      <p>• <strong>Warmup:</strong> 100–1000 iterations discarded before measurement</p>
      <p>• <strong>Iterations:</strong> 500–10,000 per test (varies by operation cost)</p>
      <p>• <strong>Timing:</strong> High-resolution <code>performance.now()</code></p>
      <p>• <strong>Calculation:</strong> Trimmed mean (discard top/bottom 10%)</p>
      <p>• <strong>Environment:</strong> ${data.platform === 'darwin' ? 'macOS' : data.platform}, Node.js ${data.node}</p>
      <p>• <strong>Automated:</strong> Benchmarks regenerate every 3 days via CI</p>
      <p>Source code available in <code>/benchmark</code> directory. Run with <code>npm run bench</code>.</p>
    </div>
  </div>

  <footer>
    <a href="https://whatfw.com">What Framework</a> v${version} — <a href="https://react.whatfw.com">React Compat</a> — <a href="https://www.npmjs.com/package/what-framework">npm</a> — <a href="https://github.com/CelsianJs/what-framework">GitHub</a>
  </footer>
</body>
</html>
`;

writeFileSync(htmlPath, html);
console.log(`\n[bench] Updated ${htmlPath}`);
console.log(`[bench] Version: v${version}, Date: ${dateStr}, Node: ${data.node}`);
