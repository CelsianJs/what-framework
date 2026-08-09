// Regressions for three defects found in the 2026-08-09 audit, all introduced or
// left open by the C2 cross-user-cache fix itself:
//
//   1. `vary` declared as anything other than an array produced a CONSTANT cache
//      key and a `public` Cache-Control, which is the exact cross-user leak the
//      vary mechanism exists to prevent. `vary: 'cookie:session'` is the most
//      natural shorthand and it was the worst case: varyString() ran
//      Object.entries() over the STRING and keyed on its character indices.
//   2. The filesystem store wrote the raw key (whose vary segment carries raw
//      cookie VALUES) into the entry body and both reverse indexes, so session
//      tokens landed on disk in cleartext. The Redis store redacted; this one
//      did not.
//   3. `revalidate: 0` meant cache-forever instead of always-revalidate.
//
// The through-line: for every one of these, the safe reading and the unsafe
// reading of the same value diverged in two places that did not consult each
// other. Each test below pins BOTH sides.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cacheKey, resolveVary, normalizeVaryDeclaration, redactVary } from '../src/key.js';
import { buildCacheHeaders } from '../src/headers.js';
import { makeEntry, isFresh, isServableStale } from '../src/stores/store-interface.js';
import { createFilesystemStore } from '../src/stores/filesystem-store.js';
import { createMemoryStore } from '../src/stores/memory-store.js';

const ALICE = { cookie: 'session=alice-token' };
const BOB = { cookie: 'session=bob-token' };

describe('normalizeVaryDeclaration', () => {
  it('accepts a bare string as one-element shorthand', () => {
    assert.deepEqual(normalizeVaryDeclaration('cookie:session'), ['cookie:session']);
  });

  it('passes a string list through unchanged', () => {
    assert.deepEqual(normalizeVaryDeclaration(['cookie:session', 'authorization']), ['cookie:session', 'authorization']);
  });

  it('treats null and undefined as "no vary"', () => {
    assert.deepEqual(normalizeVaryDeclaration(null), []);
    assert.deepEqual(normalizeVaryDeclaration(undefined), []);
    assert.deepEqual(normalizeVaryDeclaration(''), []);
  });

  // Fail closed. The cost of a false bypass is a slower page; the cost of a
  // false cache is one visitor's authenticated HTML served to everyone.
  for (const [label, value] of [
    ['a plain object', { 'cookie:session': 'x' }],
    ['an empty object', {}],
    ['a number', 5],
    ['a boolean', true],
    ['an array holding a non-string', ['cookie:session', 7]],
    ['an array holding an empty string', ['']],
  ]) {
    it(`refuses ${label} rather than silently keying one shared entry`, () => {
      assert.equal(normalizeVaryDeclaration(value), null);
    });
  }
});

describe('vary declaration shapes cannot produce a shared cache key', () => {
  it('an array keys per user (the case that already worked)', () => {
    const a = cacheKey({ path: '/dash', vary: ['cookie:session'], headers: ALICE });
    const b = cacheKey({ path: '/dash', vary: ['cookie:session'], headers: BOB });
    assert.notEqual(a, b);
  });

  // The regression. Before the fix both of these returned the SAME string, built
  // from the character indices of 'cookie:session'.
  it('a bare string keys per user too', () => {
    const a = cacheKey({ path: '/dash', vary: 'cookie:session', headers: ALICE });
    const b = cacheKey({ path: '/dash', vary: 'cookie:session', headers: BOB });
    assert.notEqual(a, b);
    assert.ok(!a.includes('0=c'), 'must not enumerate the declaration string as character indices');
  });

  it('is the same key an equivalent array declaration produces', () => {
    assert.equal(
      cacheKey({ path: '/dash', vary: 'cookie:session', headers: ALICE }),
      cacheKey({ path: '/dash', vary: ['cookie:session'], headers: ALICE }),
    );
  });

  for (const [label, value] of [['a number', 5], ['a boolean', true]]) {
    it(`throws rather than building a key from ${label}`, () => {
      assert.throws(
        () => cacheKey({ path: '/dash', vary: value, headers: ALICE }),
        /cannot build a cache key/,
      );
    });
  }

  it('still accepts an already-resolved name -> value map', () => {
    const key = cacheKey({ path: '/dash', vary: { 'cookie:session': 'alice-token' } });
    assert.ok(key.includes('alice-token'));
  });

  it('resolveVary refuses an unresolvable shape instead of returning it verbatim', () => {
    assert.equal(resolveVary('cookie:session', null), null, 'no headers means unresolvable');
    assert.equal(resolveVary(5, ALICE), null);
    assert.deepEqual(resolveVary('cookie:session', ALICE), { 'cookie:session': 'alice-token' });
  });
});

describe('Cache-Control agrees with the cache key about whether a route is per-user', () => {
  const entry = { maxAge: 300, swrWindow: 300, status: 200 };
  const config = { mode: 'hybrid' };

  it('marks an array declaration private', () => {
    const h = buildCacheHeaders(entry, config, 'MISS', ['cookie:session']);
    assert.equal(h['Cache-Control'], 'private, no-store');
    assert.equal(h.Vary, 'Cookie');
  });

  // The second half of the regression: buildCacheHeaders re-tested Array.isArray
  // on the raw declaration, so a string declaration got `public` at the same time
  // the key builder was collapsing every user onto one entry. Both failures
  // pointed the same way, so there was no second line of defence.
  it('marks a bare string declaration private too', () => {
    const h = buildCacheHeaders(entry, config, 'MISS', 'cookie:session');
    assert.equal(h['Cache-Control'], 'private, no-store');
    assert.equal(h.Vary, 'Cookie');
  });

  it('never emits public for an unresolvable declaration shape', () => {
    for (const bad of [{}, { 'cookie:session': 'x' }, 5, true, ['']]) {
      const h = buildCacheHeaders(entry, config, 'MISS', bad);
      assert.equal(h['Cache-Control'], 'private, no-store', `shape ${JSON.stringify(bad)} must not be public`);
    }
  });

  it('reads config.vary with the same normalization when no explicit vary is passed', () => {
    const h = buildCacheHeaders(entry, { mode: 'hybrid', vary: 'cookie:session' }, 'MISS');
    assert.equal(h['Cache-Control'], 'private, no-store');
  });

  it('still emits public for a route that genuinely does not vary', () => {
    const h = buildCacheHeaders(entry, config, 'MISS', undefined);
    assert.match(h['Cache-Control'], /^public, s-maxage=300/);
    assert.equal(h.Vary, undefined);
  });
});

describe('revalidate: 0 means always revalidate, not cache forever', () => {
  const now = 1_000_000;

  it('an undeclared revalidate on a static route stays durable', () => {
    const e = makeEntry({ html: 'x' }, { mode: 'static' }, now);
    assert.equal(e.expiresAt, Infinity);
    assert.equal(isFresh(e, now + 10 * 365 * 24 * 3600 * 1000), true);
  });

  it('an undeclared revalidate on a hybrid route uses the 60s default', () => {
    const e = makeEntry({ html: 'x' }, { mode: 'hybrid' }, now);
    assert.equal(e.maxAge, 60);
    assert.equal(e.expiresAt, now + 60_000);
  });

  // The regression: `Number(config.revalidate ?? fallback)` correctly propagated
  // the 0, and then `maxAge > 0 ? ... : Infinity` turned it into never-expires.
  // A developer writing revalidate: 0 to switch caching OFF got cache-forever.
  for (const mode of ['static', 'hybrid']) {
    it(`an explicit revalidate: 0 on a ${mode} route is stale immediately`, () => {
      const e = makeEntry({ html: 'x' }, { mode, revalidate: 0 }, now);
      assert.equal(e.maxAge, 0);
      assert.notEqual(e.expiresAt, Infinity);
      assert.equal(isFresh(e, now), false);
      assert.equal(isServableStale(e, now), false, 'swr window is 0, so it must not be served stale either');
    });
  }

  it('an explicit positive revalidate is unaffected', () => {
    const e = makeEntry({ html: 'x' }, { mode: 'hybrid', revalidate: 30 }, now);
    assert.equal(e.expiresAt, now + 30_000);
    assert.equal(isFresh(e, now + 29_000), true);
    assert.equal(isFresh(e, now + 31_000), false);
  });
});

// Store conformance. Written as a loop over stores so a store added later cannot
// regress it: the only requirement is that a key's vary segment (raw cookie
// VALUES) never reaches persisted bytes.
describe('no store persists a raw vary value', () => {
  const SENTINEL = 'SUPER_SECRET_SESSION_JWT_DO_NOT_PERSIST';
  const key = cacheKey({ path: '/dash', vary: ['cookie:session'], headers: { cookie: `session=${SENTINEL}` } });
  const entry = { html: '<h1>hi</h1>', tags: ['t1'], path: '/dash', renderedAt: 0, maxAge: 60, swrWindow: 60, expiresAt: 1 };

  it('the unredacted key does contain the sentinel (guards the test itself)', () => {
    assert.ok(key.includes(SENTINEL));
    assert.ok(!redactVary(key).includes(SENTINEL));
  });

  it('filesystem store: not in any file, in any index, anywhere under the cache dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'what-isr-vary-'));
    try {
      const store = createFilesystemStore({ dir });
      await store.set(key, entry);

      const offenders = [];
      const walk = async (d) => {
        for (const name of await readdir(d)) {
          const p = join(d, name);
          if ((await stat(p)).isDirectory()) await walk(p);
          else if ((await readFile(p, 'utf8')).includes(SENTINEL)) offenders.push(p);
        }
      };
      await walk(dir);
      assert.deepEqual(offenders, [], 'session token found in persisted bytes');

      // Redaction must not break the store: reads, tag purge and path purge all
      // still have to resolve through the redacted key.
      assert.deepEqual(await store.get(key), entry);
      assert.deepEqual(await store.deleteByPath('/dash'), [redactVary(key)]);
      assert.equal(await store.get(key), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('filesystem store: tag purge also resolves through the redacted key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'what-isr-vary-'));
    try {
      const store = createFilesystemStore({ dir });
      await store.set(key, entry);
      assert.deepEqual(await store.deleteByTag('t1'), [redactVary(key)]);
      assert.equal(await store.get(key), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('memory store: nothing is persisted, so the raw key never leaves the process', async () => {
    const store = createMemoryStore();
    await store.set(key, entry);
    assert.deepEqual(await store.get(key), entry);
  });
});
