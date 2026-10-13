import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'what-version-history-'));
  const files = {
    'scripts/bump-version.mjs': readFileSync(join(root, 'scripts/bump-version.mjs'), 'utf8'),
    'package.json': JSON.stringify({ name: 'what-fw', private: true, version: '0.13.7' }),
    'packages/core/package.json': JSON.stringify({ name: 'what-core', version: '0.13.7' }),
    'packages/mcp-server/package.json': JSON.stringify({ name: 'what-mcp', version: '0.12.4' }),
    'CHANGELOG.md': '# Changelog\n\n## [0.13.7] - 2026-09-06\n\nHistorical notes.\n',
    'docs/releases/v0.13.7.md': '# What 0.13.7\nHistorical notes.\n',
    'README.md': 'This behavior exists as of v0.13.7.\n',
    'docs-site/index.html': '<span class="logo-badge">v0.13.7</span>\n<p>Measured 2026-08-11: What 0.13.7 7.97KB.</p>\n<div class="footer-meta">v0.13.7 &middot; MIT License</div>\n',
    'docs-site/docs/reference/For.html': '<span class="logo-badge">v0.13.7</span>\n<p>Supported as of 0.13.7; other work tracked for 0.13.7.</p>\n',
    'sites/benchmarks/index.html': '<p class="last-updated">Measured <time datetime="2026-09-04">September 4</time> · v0.13.7 · linux</p>\n<table><tr><td><a href="https://whatfw.com">What Framework</a> v0.13.7</td><td>7.97KB</td></tr></table>\n<footer>\n<a href="https://whatfw.com">What Framework</a> v0.13.7 — npm\n</footer>\n',
  };
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), contents);
  }
  return { dir, files };
}

function bump(dir, ...args) {
  const result = spawnSync(process.execPath, [join(dir, 'scripts/bump-version.mjs'), 'patch', ...args], {
    cwd: dir, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}

test('version bumps update release chrome, not measured results or historical prose', () => {
  const { dir, files } = fixture();
  try {
    for (const next of ['0.13.8', '0.13.9']) {
      const result = bump(dir);
      const read = file => readFileSync(join(dir, file), 'utf8');
      assert.equal(JSON.parse(read('packages/core/package.json')).version, next);
      assert.equal(JSON.parse(read('package.json')).version, next);
      assert.equal(JSON.parse(read('packages/mcp-server/package.json')).version, '0.12.4');
      assert.equal(read('docs-site/index.html'), files['docs-site/index.html']
        .replace('logo-badge">v0.13.7', `logo-badge">v${next}`)
        .replace('footer-meta">v0.13.7', `footer-meta">v${next}`));
      assert.equal(read('docs-site/docs/reference/For.html'), files['docs-site/docs/reference/For.html']
        .replace('logo-badge">v0.13.7', `logo-badge">v${next}`));
      assert.equal(read('sites/benchmarks/index.html'), files['sites/benchmarks/index.html']
        .replace('v0.13.7 — npm', `v${next} — npm`));
      assert.equal(read('README.md'), files['README.md']);
      assert.equal(read('docs/releases/v0.13.7.md'), files['docs/releases/v0.13.7.md']);
      assert.ok(read('CHANGELOG.md').endsWith(files['CHANGELOG.md'].slice('# Changelog\n\n'.length)));
      assert.doesNotMatch(result.stderr, /stale-looking/, 'historical versions are not stale release badges');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dry-run version preparation leaves every fixture file untouched', () => {
  const { dir, files } = fixture();
  try {
    bump(dir, '--dry');
    for (const [file, contents] of Object.entries(files)) {
      assert.equal(readFileSync(join(dir, file), 'utf8'), contents, file);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
