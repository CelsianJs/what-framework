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
    assert.deepEqual(parseQuery('?a=1&a=2&b=3'), { a: ['1', '2'], b: '3' });
  });

  it('compilePath exposes paramNames', () => {
    assert.deepEqual(compilePath('/a/:b/:c').paramNames, ['b', 'c']);
  });
});
