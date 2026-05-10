import test from 'node:test';
import assert from 'node:assert/strict';
import { csrfMetaTag, validateCsrfToken } from '../src/actions.js';

test('what-server validates CSRF tokens without accepting mismatches', () => {
  assert.equal(validateCsrfToken('abc123', 'abc123'), true);
  assert.equal(validateCsrfToken('abc123', 'abc124'), false);
  assert.equal(validateCsrfToken('', 'abc124'), false);
});

test('what-server escapes CSRF meta tag content', () => {
  assert.equal(
    csrfMetaTag('x"/><script>bad</script>'),
    '<meta name="what-csrf-token" content="x&quot;/&gt;&lt;script&gt;bad&lt;/script&gt;">',
  );
});
