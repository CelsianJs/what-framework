#!/usr/bin/env node
/**
 * Benchmark Viewer — serves all generated apps + scoreboard dashboard.
 *
 * Usage: node comparison-test/benchmark/viewer/server.js
 * Then open http://localhost:4000
 *
 * Each app is served at: http://localhost:4000/apps/round-N/app-name/
 * Dashboard with scores at: http://localhost:4000/
 */

import { createServer } from 'http';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCHMARK_DIR = join(__dirname, '..');
const APPS_DIR = join(BENCHMARK_DIR, 'apps');
const PORT = 4000;

// Import DB
let getLatestRuns, getScoreboard;
try {
  const db = await import(join(BENCHMARK_DIR, 'db.js'));
  getLatestRuns = db.getLatestRuns;
  getScoreboard = db.getScoreboard;
} catch (e) {
  console.error('Could not load DB:', e.message);
  getLatestRuns = () => [];
  getScoreboard = () => [];
}

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function serveDashboard(res) {
  const board = getScoreboard();
  const runs = getLatestRuns(100);

  // Group runs by round
  const rounds = {};
  for (const r of runs) {
    const roundKey = `round-${r.round}`;
    if (!rounds[roundKey]) rounds[roundKey] = { round: r.round, prompt: r.title, slug: r.slug, complexity: r.complexity, runs: [] };
    rounds[roundKey].runs.push(r);
  }

  const roundsHtml = Object.values(rounds).sort((a, b) => b.round - a.round).map(round => {
    const cardsHtml = round.runs.map(r => {
      const appPath = r.app_path ? `/apps/${r.app_path.replace(/.*apps\//, '')}` : '#';
      const distPath = `${APPS_DIR}/${r.app_path?.replace(/.*apps\//, '')}/dist/index.html`;
      const hasDist = r.app_path && existsSync(distPath.replace('/dist/index.html', '/dist'));
      const scoreColor = r.score_overall >= 8 ? '#22c55e' : r.score_overall >= 7 ? '#eab308' : '#ef4444';
      const statusBadge = r.status === 'reviewed' ? `<span style="color:${scoreColor};font-weight:bold;font-size:28px">${r.score_overall}/10</span>` : `<span style="color:#888">${r.status}</span>`;

      return `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;min-width:280px;flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <span style="font-size:18px;font-weight:600;text-transform:capitalize">${r.framework}</span>
            ${statusBadge}
          </div>
          <div style="font-size:13px;color:#888;margin-bottom:8px">${r.model} via ${r.agent}</div>
          ${r.score_overall ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:13px;margin-bottom:12px">
            <span>Styling: <b>${r.score_styling}</b></span>
            <span>Performance: <b>${r.score_performance}</b></span>
            <span>Code Quality: <b>${r.score_code_quality}</b></span>
            <span>Functionality: <b>${r.score_functionality}</b></span>
          </div>` : ''}
          <div style="display:flex;gap:12px;font-size:12px;color:#888;margin-bottom:12px">
            <span>${r.total_tokens ? Math.round(r.total_tokens / 1000) + 'K tokens' : ''}</span>
            <span>${r.duration_ms ? Math.round(r.duration_ms / 1000) + 's' : ''}</span>
            <span>${r.build_success ? 'Build OK' : 'Build FAIL'}</span>
            <span>${r.bundle_size_bytes ? Math.round(r.bundle_size_bytes / 1024) + ' KB bundle' : ''}</span>
          </div>
          ${r.review_notes ? `<div style="font-size:12px;color:#666;margin-bottom:12px;line-height:1.4">${r.review_notes}</div>` : ''}
          <div style="display:flex;gap:8px">
            ${hasDist ? `<a href="${appPath}/dist/" target="_blank" style="padding:6px 14px;background:var(--accent);color:white;border-radius:6px;text-decoration:none;font-size:13px">Open App</a>` : ''}
            <a href="${appPath}/" target="_blank" style="padding:6px 14px;background:var(--border);border-radius:6px;text-decoration:none;font-size:13px;color:var(--text)">View Source</a>
          </div>
        </div>`;
    }).join('\n');

    const winner = round.runs.reduce((best, r) => (!best || (r.score_overall || 0) > (best.score_overall || 0)) ? r : best, null);

    return `
      <div style="margin-bottom:40px">
        <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:16px">
          <h2 style="margin:0">Round ${round.round}: ${round.prompt}</h2>
          <span style="font-size:14px;color:#888;background:var(--border);padding:2px 10px;border-radius:4px">${round.complexity}</span>
          ${winner?.score_overall ? `<span style="font-size:14px;color:#22c55e">Winner: ${winner.framework} (${winner.score_overall}/10)</span>` : ''}
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          ${cardsHtml}
        </div>
      </div>`;
  }).join('\n');

  const boardHtml = board.length ? `
    <table style="width:100%;border-collapse:collapse;margin-bottom:40px;font-size:14px">
      <thead>
        <tr style="border-bottom:2px solid var(--border);text-align:left">
          <th style="padding:8px">Framework</th><th>Model</th><th>Runs</th>
          <th>Overall</th><th>Style</th><th>Perf</th><th>Quality</th><th>Func</th><th>Avg Tokens</th><th>Bundle</th>
        </tr>
      </thead>
      <tbody>
        ${board.map(r => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:8px;font-weight:600;text-transform:capitalize">${r.framework}</td>
            <td style="color:#888">${r.model}</td>
            <td>${r.runs}</td>
            <td style="font-weight:bold;color:${r.avg_overall >= 8 ? '#22c55e' : r.avg_overall >= 7 ? '#eab308' : '#ef4444'}">${r.avg_overall}</td>
            <td>${r.avg_styling}</td><td>${r.avg_performance}</td>
            <td>${r.avg_code_quality}</td><td>${r.avg_functionality}</td>
            <td style="color:#888">${Math.round(r.avg_tokens / 1000)}K</td>
            <td style="color:#888">${r.avg_bundle_bytes ? Math.round(r.avg_bundle_bytes / 1024) + ' KB' : 'N/A'}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '<p style="color:#888">No reviewed runs yet.</p>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatFW Benchmark Dashboard</title>
  <style>
    :root { --bg: #0a0a0a; --text: #e5e5e5; --card: #141414; --border: #2a2a2a; --accent: #3b82f6; }
    * { box-sizing: border-box; margin: 0; }
    body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 32px; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    h2 { font-size: 20px; }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <h1>WhatFW Benchmark Dashboard</h1>
  <p style="color:#888;margin-bottom:32px">Cross-framework comparison: WhatFW (MCP) vs React (Playwright) vs Svelte (Playwright)</p>

  <h2 style="margin-bottom:16px">Scoreboard</h2>
  ${boardHtml}

  <h2 style="margin-bottom:16px">All Rounds</h2>
  ${roundsHtml}
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function serveFile(res, filePath) {
  if (!existsSync(filePath)) {
    // Try index.html for directory requests
    const indexPath = join(filePath, 'index.html');
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
      return;
    }

    // Directory listing
    if (existsSync(filePath.replace(/\/$/, '')) && statSync(filePath.replace(/\/$/, '')).isDirectory()) {
      const dir = filePath.replace(/\/$/, '');
      const entries = readdirSync(dir).filter(e => !e.startsWith('.') && e !== 'node_modules');
      const html = `<!DOCTYPE html><html><head><title>Files</title>
        <style>body{font-family:monospace;background:#0a0a0a;color:#e5e5e5;padding:32px}a{color:#60a5fa;display:block;padding:4px 0}</style>
        </head><body><h2>${dir.split('/').slice(-3).join('/')}</h2>
        ${entries.map(e => {
          const isDir = statSync(join(dir, e)).isDirectory();
          return `<a href="${e}${isDir ? '/' : ''}">${isDir ? '📁 ' : '📄 '}${e}</a>`;
        }).join('')}
        </body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  const content = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime });
  res.end(content);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  if (path === '/' || path === '') {
    return serveDashboard(res);
  }

  if (path.startsWith('/apps/')) {
    const relPath = path.replace('/apps/', '');
    return serveFile(res, join(APPS_DIR, relPath));
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n📊 Benchmark Dashboard: http://localhost:${PORT}`);
  console.log(`   Apps served from: ${APPS_DIR}\n`);
});
