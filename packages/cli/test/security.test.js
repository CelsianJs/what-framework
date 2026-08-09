// Security tests for CLI
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// The real implementation, not a copy: an earlier copy of safePath drifted from
// cli.js and hid both the dead-containment-check and the symlink-escape bugs.
import { safePath, isAllowedOrigin } from '../src/cli.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testDir = join(__dirname, '.test-security');

describe('security', () => {
  before(() => {
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, 'public'), { recursive: true });
    writeFileSync(join(testDir, 'public', 'index.html'), '<html></html>');
    writeFileSync(join(testDir, 'public', '.env'), 'API_KEY=secret');
    writeFileSync(join(testDir, 'secret.txt'), 'secret data');
    symlinkSync(join('..', 'secret.txt'), join(testDir, 'public', 'leak.txt'));
  });

  after(() => {
    try { rmSync(testDir, { recursive: true }); } catch {}
  });

  describe('path traversal prevention', () => {
    it('should block ../secret.txt style attacks', () => {
      const base = join(testDir, 'public');
      const result = safePath(base, '../secret.txt');
      assert.equal(result, null, 'Path traversal should return null');
    });

    it('should block ../../etc/passwd style attacks', () => {
      const base = join(testDir, 'public');
      const result = safePath(base, '../../etc/passwd');
      assert.equal(result, null, 'Deep path traversal should return null');
    });

    it('should allow valid paths within directory', () => {
      const base = join(testDir, 'public');
      const result = safePath(base, 'index.html');
      assert.ok(result !== null, 'Valid paths should return resolved path');
      assert.ok(result.endsWith('index.html'), 'Should resolve to correct file');
    });

    it('should allow empty/current path', () => {
      const base = join(testDir, 'public');
      const result = safePath(base, '.');
      assert.ok(result !== null, 'Current directory path should be allowed');
      assert.equal(result, realpathSync(join(testDir, 'public')), 'Should resolve to base');
    });

    it('should block paths starting with ../', () => {
      const base = join(testDir, 'public');
      const attacks = [
        '../',
        '../..',
        '..\\secret.txt',
        '....//secret.txt',
        '..//..//secret.txt',
      ];

      for (const attack of attacks) {
        const result = safePath(base, attack);
        assert.equal(result, null, `Attack "${attack}" should be blocked`);
      }
    });
  });

  // The servers pass a URL pathname, which always starts with '/'. That is the
  // only shape safePath ever sees in production, so it is the shape to test:
  // resolve(base, '/foo') silently discards the base.
  describe('absolute URL pathnames (the shape the servers pass)', () => {
    const base = () => join(testDir, 'public');

    it('serves a normal file', () => {
      const result = safePath(base(), '/index.html');
      assert.ok(result !== null, '/index.html must resolve, not fall through to the SPA shell');
      assert.equal(result, join(realpathSync(base()), 'index.html'));
    });

    it('serves a percent-encoded file name', () => {
      const result = safePath(base(), '/index%2Ehtml');
      assert.equal(result, join(realpathSync(base()), 'index.html'));
    });

    it('rejects traversal', () => {
      assert.equal(safePath(base(), '/../secret.txt'), null);
      assert.equal(safePath(base(), '/sub/../../secret.txt'), null);
      assert.equal(safePath(base(), '/%2e%2e/secret.txt'), null);
    });

    it('rejects a symlink that escapes the root', () => {
      // readFileSync follows symlinks, so the resolved target must be contained.
      assert.equal(safePath(base(), '/leak.txt'), null);
    });

    it('rejects dotfiles', () => {
      assert.equal(safePath(base(), '/.env'), null);
      assert.equal(safePath(base(), '/.git/config'), null);
    });

    it('rejects NUL bytes', () => {
      assert.equal(safePath(base(), '/index.html%00.png'), null);
    });
  });

  describe('HMR websocket origin allowlist', () => {
    const allowed = new Set(['localhost:3000', '127.0.0.1:3000', '::1:3000']);

    it('accepts the dev server own origin', () => {
      assert.equal(isAllowedOrigin('http://localhost:3000', allowed), true);
      assert.equal(isAllowedOrigin('http://127.0.0.1:3000', allowed), true);
      assert.equal(isAllowedOrigin('https://localhost:3000', allowed), true);
    });

    it('rejects any other page the developer may have open', () => {
      assert.equal(isAllowedOrigin('http://evil.example', allowed), false);
      assert.equal(isAllowedOrigin('http://localhost:4000', allowed), false);
      assert.equal(isAllowedOrigin('null', allowed), false);
    });

    it('allows non-browser clients (no Origin header)', () => {
      assert.equal(isAllowedOrigin(undefined, allowed), true);
    });
  });
});
