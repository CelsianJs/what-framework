// Security tests for CLI
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// The real implementation, not a copy: an earlier copy of safePath drifted from
// cli.js and hid both the dead-containment-check and the symlink-escape bugs.
import { safePath, isAllowedOrigin, originRefusal, warnRefusedOrigin, hostAllowance, originAllowance, targetPath, resolveFrameworkModule, guarded } from '../src/cli.js';

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

  // The Host `what dev` and `what preview` answer, which reads the value as a
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

  // The Origin an HMR socket opens from: loopback, --host and the configured
  // names, at the dev port. Not any IP literal, as the Host is: any site can
  // serve its page from its own IP, and a WebSocket handshake has no
  // same-origin policy. Before, the socket took the Host's allowlist, and a
  // page served from 203.0.113.7 at the dev port read the saved file paths.
  describe('HMR websocket origin allowlist', () => {
    const allowed = originAllowance('localhost', { allowedHosts: ['app.test'] }, '');

    it('accepts the dev server own origin on loopback, --host and the configured names', () => {
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

    it('rejects an IP-literal origin that is not loopback, at the dev port too', () => {
      for (const origin of ['http://203.0.113.7:3000', 'http://198.51.100.20:3000', 'http://192.168.1.20:3000', 'http://10.0.0.5:3000',
        'https://203.0.113.7:3000', 'http://[2001:db8::1]:3000', 'http://[fe80::1]:3000', 'http://0.0.0.0:3000', 'file://localhost:3000']) {
        assert.equal(isAllowedOrigin(origin, allowed, 3000), false, origin);
      }
      assert.equal(isAllowedOrigin('http://127.8.9.10:3000', allowed, 3000), true, '127.0.0.0/8 is loopback');
    });

    it('accepts the exact --host and the --allowed-hosts names, and any origin with allowedHosts: true', () => {
      const lan = originAllowance('192.168.1.20', {}, 'box.lan');
      assert.equal(isAllowedOrigin('http://192.168.1.20:3000', lan, 3000), true);
      assert.equal(isAllowedOrigin('http://box.lan:3000', lan, 3000), true);
      assert.equal(isAllowedOrigin('http://192.168.1.21:3000', lan, 3000), false);
      assert.equal(isAllowedOrigin('http://203.0.113.7:3000', originAllowance('localhost', { allowedHosts: true }, ''), 3000), true);
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

// `--host 0.0.0.0` serves the LAN: the machine's own addresses are its pages'
// origins, so live reload accepts them; any other IP stays refused.
it('the HMR origin check accepts the machine\'s own addresses when bound to every interface', () => {
  const interfaces = () => ({ en0: [{ address: '192.168.1.20', family: 'IPv4' }, { address: 'fe80::1', family: 'IPv6' }], lo0: [{ address: '127.0.0.1', family: 'IPv4' }] });
  const wildcard = originAllowance('0.0.0.0', {}, '', interfaces);
  assert.equal(isAllowedOrigin('http://192.168.1.20:3000', wildcard, 3000), true);
  assert.equal(isAllowedOrigin('http://[fe80::1]:3000', wildcard, 3000), true);
  assert.equal(isAllowedOrigin('http://192.168.1.21:3000', wildcard, 3000), false);
  assert.equal(isAllowedOrigin('http://203.0.113.7:3000', wildcard, 3000), false);
  const local = originAllowance('localhost', {}, '', interfaces);
  assert.equal(isAllowedOrigin('http://192.168.1.20:3000', local, 3000), false);
});

// Bound to every interface, the machine's own addresses are read at each
// check: one it gave up (it moved to another network) is someone else's now,
// and one it gained (a VPN came up) is its own.
it('the machine addresses an HMR origin may carry are read at each check', () => {
  let current = { en0: [{ address: '192.168.1.184', family: 'IPv4' }] };
  const allowed = originAllowance('0.0.0.0', {}, '', () => current);
  assert.equal(isAllowedOrigin('http://192.168.1.184:3000', allowed, 3000), true);
  current = { en0: [{ address: '10.20.30.40', family: 'IPv4' }], utun3: [{ address: 'fd7a::1', family: 'IPv6' }] };
  assert.equal(isAllowedOrigin('http://192.168.1.184:3000', allowed, 3000), false, 'an address the machine gave up');
  assert.equal(isAllowedOrigin('http://10.20.30.40:3000', allowed, 3000), true, 'an address it gained');
  assert.equal(isAllowedOrigin('http://[fd7a::1]:3000', allowed, 3000), true);
});

// A refused Origin is client data: printed with every character outside
// printable ASCII escaped, the first 32 named and then one line for the rest,
// and with the reason that applies.
it('a refused HMR origin is logged escaped, capped and with its reason', () => {
  const lines = [];
  const warn = console.warn;
  console.warn = (line) => lines.push(line);
  try {
    warnRefusedOrigin('http://evil.test\u009b2J\u009d0;x\u009c\u001b', 'r');
    for (let i = 0; i < 40; i++) warnRefusedOrigin(`http://fill${i}.test:3000`, 'r');
  } finally {
    console.warn = warn;
  }
  assert.equal(lines[0], '[what dev] live reload refused for the page at "http://evil.test\\u009b2J\\u009d0;x\\u009c\\u001b": r');
  assert.ok(lines.every((line) => /^[\x20-\x7e]*$/.test(line)), 'nothing but printable ASCII reaches the terminal');
  assert.equal(lines.length, 33);
  assert.match(lines[32], /further refused origins are not listed one by one/);
  const allowed = originAllowance('localhost', {}, '');
  assert.match(originRefusal('http://localhost:4000', allowed, 3000), /its port 4000 is not this dev server's \(3000\)/);
  assert.match(originRefusal('http://evil.example:3000', allowed, 3000), /allowedHosts/);
  assert.equal(originRefusal('http://localhost:3000', allowed, 3000), null);
});
