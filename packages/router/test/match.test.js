// Isomorphic matcher (Phase 6): match.js must work server-side with no DOM.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoute, parseQuery, compilePath } from '../src/match.js';

describe('isomorphic matcher', () => {
  it('imports and runs with no window/location/document', () => {
    // This file runs in plain Node — the mere fact the import above succeeded and
    // these calls work proves match.js has no DOM dependency.
    assert.equal(typeof globalThis.window, 'undefined');
    assert.ok(matchRoute('/x', [{ path: '/x', component: 1 }]));
  });

  it('matches a dynamic :param route', () => {
    const routes = [{ path: '/blog/:slug', component: 'P' }];
    const m = matchRoute('/blog/hello', routes);
    assert.equal(m.route.component, 'P');
    assert.deepEqual(m.params, { slug: 'hello' });
  });

  it('matches file-based [param] and [...catchall] syntax', () => {
    assert.deepEqual(matchRoute('/u/42', [{ path: '/u/[id]' }]).params, { id: '42' });
    assert.deepEqual(matchRoute('/docs/a/b/c', [{ path: '/docs/[...rest]' }]).params, { rest: 'a/b/c' });
  });

  it('returns null when nothing matches', () => {
    assert.equal(matchRoute('/nope', [{ path: '/x' }]), null);
  });

  it('decodes param values', () => {
    assert.deepEqual(matchRoute('/s/a%20b', [{ path: '/s/:q' }]).params, { q: 'a b' });
  });

  it('parseQuery collects repeated keys into arrays', () => {
    assert.deepEqual({ ...parseQuery('?a=1&a=2&b=3') }, { a: ['1', '2'], b: '3' });
  });

  it('compilePath exposes paramNames', () => {
    assert.deepEqual(compilePath('/a/:b/:c').paramNames, ['b', 'c']);
  });
});

describe('matcher path traversal', () => {
  it('rejects percent-encoded traversal in a :param', () => {
    assert.equal(matchRoute('/u/%2e%2e%2f%2e%2e%2fetc%2fpasswd', [{ path: '/u/:id' }]), null);
    assert.equal(matchRoute('/u/..%2fsecret', [{ path: '/u/:id' }]), null);
    assert.equal(matchRoute('/u/%2E%2E%2Fsecret', [{ path: '/u/:id' }]), null);
  });

  it('rejects an encoded backslash in a :param', () => {
    assert.equal(matchRoute('/u/a%5cb', [{ path: '/u/:id' }]), null);
    assert.equal(matchRoute('/u/%5c%5cevil.com', [{ path: '/u/:id' }]), null);
  });

  it('rejects a literal .. segment in a :param', () => {
    assert.equal(matchRoute('/u/..', [{ path: '/u/:id' }]), null);
  });

  it('decodes exactly once, so double-encoding stays inert', () => {
    assert.deepEqual(matchRoute('/u/%252e%252e%252fetc', [{ path: '/u/:id' }]).params, {
      id: '%2e%2e%2fetc',
    });
  });

  it('rejects traversal inside a catch-all but keeps normal nesting', () => {
    assert.equal(matchRoute('/docs/a/../../etc', [{ path: '/docs/[...rest]' }]), null);
    assert.equal(matchRoute('/docs/a/%2e%2e/etc', [{ path: '/docs/[...rest]' }]), null);
    assert.deepEqual(matchRoute('/docs/a/b/c', [{ path: '/docs/[...rest]' }]).params, { rest: 'a/b/c' });
  });

  it('treats a malformed percent-escape as a non-match instead of throwing', () => {
    assert.equal(matchRoute('/u/%zz', [{ path: '/u/:id' }]), null);
  });

  it('falls through to a less specific route when a param is rejected', () => {
    const routes = [{ path: '/u/:id', component: 'P' }, { path: '/u/*', component: 'C' }];
    assert.equal(matchRoute('/u/%2e%2e%2fx', routes), null);
    assert.equal(matchRoute('/u/ok', routes).route.component, 'P');
  });
});

describe('parseQuery prototype safety', () => {
  it('does not treat inherited keys as repeated keys', () => {
    const q = parseQuery('?toString=admin');
    assert.equal(q.toString, 'admin');
  });

  it('does not replace the prototype via __proto__', () => {
    const q = parseQuery('?__proto__=y&a=1');
    assert.equal(Object.getPrototypeOf(q), null);
    assert.equal(q.a, '1');
    assert.equal({}.y, undefined);
  });

  it('still collects genuinely repeated keys', () => {
    assert.deepEqual({ ...parseQuery('?toString=a&toString=b') }, { toString: ['a', 'b'] });
  });
});

describe('parseQuery URL semantics', () => {
  it('decodes form spaces and preserves literal and encoded equals signs', () => {
    assert.deepEqual({ ...parseQuery('?q=hello+world&token=a=b&encoded=a%3Db%2Bc') }, {
      q: 'hello world', token: 'a=b', encoded: 'a=b+c',
    });
  });

  it('tolerates malformed percent escapes with URLSearchParams semantics', () => {
    assert.deepEqual({ ...parseQuery('?q=%&bad=%ZZ&utf8=%E0%A4') }, {
      q: '%', bad: '%ZZ', utf8: '\uFFFD',
    });
  });

  it('preserves ordered duplicates, empty names, and empty values', () => {
    assert.deepEqual({ ...parseQuery('?sort=b&sort=a&=first&=second&flag&blank=') }, {
      sort: ['b', 'a'], '': ['first', 'second'], flag: '', blank: '',
    });
  });
});
