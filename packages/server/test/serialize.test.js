// Regression: serializeState must neutralize </script> breakout so SSR/island
// state with user-controlled values cannot inject markup. (AUDIT-2026-06-06 H3)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serializeState } from '../src/serialize.js';

const LS = String.fromCharCode(0x2028); // line separator
const PS = String.fromCharCode(0x2029); // paragraph separator

describe('serializeState (H3 XSS guard)', () => {
  it('escapes </script> so it cannot break out of a script tag', () => {
    const out = serializeState({ name: '</script><img src=x onerror=alert(1)>' });
    assert.ok(!out.includes('</script>'), `output still contains </script>: ${out}`);
    assert.ok(out.includes('\\u003c/script'), 'expected < to be escaped to \\u003c');
  });

  it('escapes <, >, & and stays valid JSON (round-trips)', () => {
    const value = { a: '<b>&amp;</b>', n: 42, list: ['<x>', '&y'] };
    const out = serializeState(value);
    assert.ok(!/[<>&]/.test(out), `raw < > & leaked: ${out}`);
    assert.deepEqual(JSON.parse(out), value, 'must still parse back to the original value');
  });

  it('escapes U+2028 / U+2029 line separators', () => {
    const value = { s: `a${LS}b${PS}c` };
    const out = serializeState(value);
    assert.ok(out.includes('\\u2028') && out.includes('\\u2029'));
    assert.ok(!out.includes(LS) && !out.includes(PS), 'raw separators leaked');
    assert.deepEqual(JSON.parse(out), value);
  });
});
