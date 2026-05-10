// Security tests for CLI
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testDir = join(__dirname, '.test-security');

import { safePath } from '../src/cli.js';

describe('security', () => {
  before(() => {
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, 'public'), { recursive: true });
    writeFileSync(join(testDir, 'public', 'index.html'), '<html></html>');
    writeFileSync(join(testDir, 'secret.txt'), 'secret data');
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


    it('should allow normal URL paths that start with /', () => {
      const base = join(testDir, 'public');
      const result = safePath(base, '/index.html');
      assert.ok(result !== null, 'URL paths should be allowed');
      assert.ok(result.endsWith('index.html'), 'Should resolve to correct file');
    });

    it('should decode URL paths safely', () => {
      const base = join(testDir, 'public');
      writeFileSync(join(testDir, 'public', 'space file.txt'), 'ok');
      const result = safePath(base, '/space%20file.txt');
      assert.ok(result !== null, 'URL-encoded paths should be allowed');
      assert.ok(result.endsWith('space file.txt'), 'Should decode URL path components');
    });

    it('should block URL-encoded traversal attacks', () => {
      const base = join(testDir, 'public');
      assert.equal(safePath(base, '/%2e%2e/secret.txt'), null);
      assert.equal(safePath(base, '/%2Fetc/passwd'), null);
      assert.equal(safePath(base, '/%00secret.txt'), null);
    });

    it('should allow empty/current path', () => {
      const base = join(testDir, 'public');
      const result = safePath(base, '.');
      assert.ok(result !== null, 'Current directory path should be allowed');
      assert.equal(result, join(testDir, 'public'), 'Should resolve to base');
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
});
