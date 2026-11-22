// Security tests for CLI
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// The real implementation, not a copy: an earlier copy of safePath drifted from
// cli.js and hid both the dead-containment-check and the symlink-escape bugs.
import { safePath, isAllowedOrigin, hostAllowance, targetPath, resolveFrameworkModule, guarded } from '../src/cli.js';

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

  // The Host `what dev` and `what preview` answer, and the Origin an HMR
  // socket opens from: one allowlist for both, which reads the value as a
  // host before any name test.
  describe('the dev host allowlist', () => {
    const allowed = hostAllowance('localhost', { allowedHosts: ['app.test'] }, 'tunnel.example');

    it('answers localhost, *.localhost, IP literals, --host and the configured names', () => {
      for (const host of ['localhost', 'localhost:3000', 'shop.localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'app.test', 'APP.test:3000', 'tunnel.example']) {
        assert.equal(allowed(host), true, host);
      }
    });

    it('refuses other names, and values that are not a host at all', () => {
      for (const host of ['evil.test', 'evil.test:3000', 'evil.test/.localhost', 'evil.test\\.localhost', 'evil.test:5380#.localhost', 'a b.localhost', '', undefined]) {
        assert.equal(allowed(host), false, String(host));
      }
    });

    it('allowedHosts: true answers any host, and still only a host', () => {
      const any = hostAllowance('localhost', { allowedHosts: true }, '');
      assert.equal(any('anything.example:8080'), true);
      assert.equal(any('evil.test/.localhost'), false);
    });
  });

  describe('HMR websocket origin allowlist', () => {
    const allowed = hostAllowance('localhost', { allowedHosts: ['app.test'] }, '');

    it('accepts the dev server own origin, on every host the server answers', () => {
      assert.equal(isAllowedOrigin('http://localhost:3000', allowed, 3000), true);
      assert.equal(isAllowedOrigin('http://127.0.0.1:3000', allowed, 3000), true);
      assert.equal(isAllowedOrigin('https://localhost:3000', allowed, 3000), true);
      assert.equal(isAllowedOrigin('http://[::1]:3000', allowed, 3000), true);
      assert.equal(isAllowedOrigin('http://shop.localhost:3000', allowed, 3000), true);
      assert.equal(isAllowedOrigin('http://app.test:3000', allowed, 3000), true);
      assert.equal(isAllowedOrigin('http://localhost', allowed, 80), true);
    });

    it('rejects any other page the developer may have open', () => {
      assert.equal(isAllowedOrigin('http://evil.example', allowed, 3000), false);
      assert.equal(isAllowedOrigin('http://evil.example:3000', allowed, 3000), false);
      assert.equal(isAllowedOrigin('http://localhost:4000', allowed, 3000), false);
      assert.equal(isAllowedOrigin('null', allowed, 3000), false);
    });

    it('allows non-browser clients (no Origin header)', () => {
      assert.equal(isAllowedOrigin(undefined, allowed, 3000), true);
    });
  });

  // `what dev` and `what preview` answer 400 for a target that is not a path,
  // instead of throwing out of the request listener (which ended the process).
  describe('the dev and preview servers read a request target as a path', () => {
    it('`//x` is a path, never another host, and nothing throws', () => {
      assert.equal(targetPath('/a/b?q=1'), '/a/b');
      assert.equal(targetPath('//'), '//');
      assert.equal(targetPath('//evil.test/x'), '//evil.test/x');
      assert.equal(targetPath('//[::1'), '//[::1');
      for (const target of ['*', 'http://evil.test/', 'http://[', '', undefined]) {
        assert.doesNotThrow(() => targetPath(target));
        assert.equal(targetPath(target), null, String(target));
      }
    });
  });

  // One request must not end `what dev` (round 5, V3): /@what/<name> looks a
  // name up among its own entries only, and a listener that throws or rejects
  // answers 500.
  describe('the dev server survives any one request', () => {
    it('/@what/<name> never reaches what an object inherits', () => {
      for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '__proto__/x.js', 'constructor/x.js']) {
        assert.equal(resolveFrameworkModule(name, {}), null, name);
      }
    });

    it('a listener that throws or rejects answers 500', async () => {
      const answers = [];
      const response = () => {
        const res = { headersSent: false, writeHead(status) { answers.push(status); }, end() {}, destroy() { answers.push('destroyed'); } };
        return res;
      };
      const error = console.error;
      console.error = () => {};
      try {
        guarded(() => { throw new Error('sync'); })({ method: 'GET', url: '/' }, response());
        guarded(async () => { throw new Error('async'); })({ method: 'GET', url: '/' }, response());
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        console.error = error;
      }
      assert.deepEqual(answers, [500, 500]);
    });
  });
});
