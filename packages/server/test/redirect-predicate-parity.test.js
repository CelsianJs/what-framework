// The framework has two redirect-safety predicates on purpose:
//   isSafeUrl      (packages/router/src/index.js)      client navigation target
//   safeLocalPath  (packages/server/src/action-handler.js)  server Location: header
// The server response API (response.js) uses the second: redirect() takes
// exactly what safeLocalPath takes, and leaving the site is redirectExternal(),
// a separate call that takes an absolute http(s) URL and nothing else
// (security review #2: redirect() was gated by isSafeUrl, an open redirect).
// They answer different questions, so they must not be unified. What must never
// break is their ordering: the server predicate is strictly narrower, so a
// target the client router refuses can never be emitted as a Location: header.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { isSafeUrl } = await import('../../router/src/index.js');
const { safeLocalPath } = await import('../src/action-handler.js');
const { safeLocalPath: isrSafeLocalPath } = await import('../../cache/src/local-path.js');
const { createCacheEngine, createMemoryStore } = await import('../../cache/src/index.js');
const { createResponse, localRedirectTarget, externalRedirectTarget } = await import('../src/response.js');

// Targets spanning both predicates: open-redirect vectors, dangerous schemes,
// absolute URLs the client allows, and ordinary local paths.
const TARGETS = [
  '/', '/dashboard', '/a/b?x=1', '/a?next=%2Fb', '/#hash', '/a#b',
  '//evil.com/x', '\\\\evil.com', '/\\evil.com', '\\/evil.com', '/a\\b',
  ' //evil.com', '\t//evil.com', '\n/\\evil.com',
  'javascript:alert(1)', 'JavaScript:alert(1)', 'java\tscript:alert(1)',
  'data:text/html,x', 'vbscript:x', 'blob:http://localhost/x', 'about:blank',
  'filesystem:http://localhost/temporary/x',
  'http://localhost/a', 'https://example.com/checkout', 'mailto:a@b.c', 'tel:+1',
  'relative/path', '', '   ',
];

describe('redirect predicate parity', () => {
  it('safeLocalPath rejects everything isSafeUrl rejects', () => {
    for (const t of TARGETS) {
      if (!isSafeUrl(t)) {
        assert.equal(safeLocalPath(t), null,
          `isSafeUrl refuses ${JSON.stringify(t)}, so safeLocalPath must too`);
      }
    }
  });

  it('safeLocalPath is strictly narrower, not equivalent', () => {
    // If the two ever agree on everything, one of them has the wrong answer:
    // absolute http(s) and mailto: are valid client targets and invalid
    // Location: headers.
    const clientOnly = TARGETS.filter(t => isSafeUrl(t) && safeLocalPath(t) === null);
    assert.ok(clientOnly.includes('https://example.com/checkout'));
    assert.ok(clientOnly.includes('mailto:a@b.c'));
  });

  it('safeLocalPath refuses a path whose canonical form is protocol-relative (dot segments, tabs)', () => {
    for (const t of ['/.//evil.test', '/..//evil.test', '/%2e//evil.test', '/x/..//evil.test', '/./\t/evil.test', '/.//evil.test/x?y=1']) {
      assert.equal(safeLocalPath(t), null, JSON.stringify(t));
      assert.equal(localRedirectTarget(t), null, JSON.stringify(t));
      const response = createResponse();
      response.redirect(t);
      assert.equal(response.location, '/', `${JSON.stringify(t)} redirects home instead`);
    }
    assert.equal(safeLocalPath('/a/./b/../c'), '/a/c', 'dot segments that stay on the site are fine');
  });

  // what-isr cannot import what-server, so it carries the same function. A
  // copy that missed a fix passed "/.//evil.test/x" to a CDN adapter as
  // "//evil.test/x", which an adapter resolving it against its origin sends,
  // with its API token, to evil.test.
  it('what-isr\'s copy is the same function, and its purge paths follow it', async () => {
    assert.equal(isrSafeLocalPath.toString(), safeLocalPath.toString(), 'packages/cache/src/local-path.js differs from action-handler.js');
    const purged = [];
    const engine = createCacheEngine({ store: createMemoryStore(), cdn: { name: 'probe', purge: async (paths) => { purged.push(...paths); } } });
    for (const t of [...TARGETS, '/.//evil.test/x', '/..//evil.test/x', '/%2e//evil.test/x', '/x/..//evil.test/x', '/./\t/evil.test/x', '/ok']) {
      assert.equal(isrSafeLocalPath(t), safeLocalPath(t), JSON.stringify(t));
      await engine.revalidatePath(t).catch(() => {});
    }
    assert.deepEqual(purged.filter((p) => !p.startsWith('/') || p.startsWith('//')), [], 'a purge path left the site');
    assert.ok(purged.includes('/ok'));
  });

  it('both accept an ordinary same-origin path', () => {
    assert.equal(isSafeUrl('/a/b?x=1'), true);
    assert.equal(safeLocalPath('/a/b?x=1'), '/a/b?x=1');
  });
});

describe('the response API follows safeLocalPath', () => {
  const quietly = (fn) => {
    const warn = console.warn;
    console.warn = () => {};
    try { return fn(); } finally { console.warn = warn; }
  };

  it('redirect() keeps a target exactly when safeLocalPath accepts it, and otherwise goes to "/"', () => {
    for (const t of [...TARGETS, 'https://evil.example/phish', 'http://evil.example', 'HTTPS://evil.example']) {
      const response = createResponse();
      quietly(() => response.redirect(t));
      if (safeLocalPath(t) === null) {
        assert.equal(localRedirectTarget(t), null, JSON.stringify(t));
        assert.equal(response.location, '/', `refused ${JSON.stringify(t)} must fall back to "/"`);
      } else {
        assert.equal(response.location, localRedirectTarget(t), JSON.stringify(t));
        assert.equal(new URL(response.location, 'http://localhost').origin, 'http://localhost');
      }
      assert.equal(response.status, 302);
    }
  });

  it('redirect() keeps the fragment of a local target', () => {
    const response = createResponse();
    response.redirect('/docs?x=1#install');
    assert.equal(response.location, '/docs?x=1#install');
  });

  it('a target carrying CR/LF never reaches the Location header with them', () => {
    const response = createResponse();
    quietly(() => response.redirect('/ok\r\nSet-Cookie: pwn=1'));
    assert.doesNotMatch(response.location, /[\r\n]/);
    assert.doesNotThrow(() => new Headers({ location: response.location }));
  });

  it('redirectExternal() takes an absolute http(s) URL with no credentials, and nothing else', () => {
    const accepted = ['https://example.com/checkout', 'http://example.com', 'HTTPS://EXAMPLE.com/a?b#c'];
    const refused = ['/local', '//evil.example', 'javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.c',
      'https://trusted.example@evil.example/', 'ftp://example.com', '', 'not a url'];
    for (const t of accepted) {
      const response = createResponse();
      response.redirectExternal(t, 303);
      assert.equal(response.location, externalRedirectTarget(t));
      assert.equal(new URL(response.location).href, response.location);
      assert.equal(response.status, 303);
    }
    for (const t of refused) {
      const response = createResponse();
      quietly(() => response.redirectExternal(t));
      assert.equal(response.location, '/', JSON.stringify(t));
    }
  });

  it('a refused target is reported in development', () => {
    const warn = console.warn;
    const warnings = [];
    console.warn = (message) => warnings.push(message);
    try {
      createResponse().redirect('https://evil.example');
    } finally {
      console.warn = warn;
    }
    assert.match(warnings.join('\n'), /ERR_SSR_UNSAFE_REDIRECT/);
  });
});
