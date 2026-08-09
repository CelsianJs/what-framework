// The framework has two redirect-safety predicates on purpose:
//   isSafeUrl      (packages/router/src/index.js)      client navigation target
//   safeLocalPath  (packages/server/src/action-handler.js)  server Location: header
// They answer different questions, so they must not be unified. What must never
// break is their ordering: the server predicate is strictly narrower, so a
// target the client router refuses can never be emitted as a Location: header.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { isSafeUrl } = await import('../../router/src/index.js');
const { safeLocalPath } = await import('../src/action-handler.js');

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

  it('both accept an ordinary same-origin path', () => {
    assert.equal(isSafeUrl('/a/b?x=1'), true);
    assert.equal(safeLocalPath('/a/b?x=1'), '/a/b?x=1');
  });
});
