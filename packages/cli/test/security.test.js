// Security tests for CLI
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { join, normalize, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const testDir = join(__dirname, '.test-security');

// Recreate safePath function for testing (same logic as in cli.js)
function safePath(base, userPath) {
  try {
    // Reject paths that contain .. segments (path traversal attempt)
    const normalized = normalize(userPath);
    if (normalized.startsWith('..') || normalized.includes('/..') || normalized.includes('\\..')) {
      return null;
    }

    // Get the real base path (resolve symlinks)
    const realBase = realpathSync(base);

    // Resolve the user path against the base
    const resolved = resolve(realBase, normalized);

    // Double-check: ensure resolved path is within base
    if (!resolved.startsWith(realBase + '/') && resolved !== realBase) {
      return null;
    }

    return resolved;
  } catch {
    return null;
  }
}

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
