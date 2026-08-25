// Head dedup keys are built from user-supplied attrs (and fall back to
// JSON.stringify, which always contains quotes). Interpolating one straight into
// a CSS attribute selector raises "DOMException: Invalid selector" and takes all
// head management down with it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const { Head } = await import('../src/head.js');

function headKeys() {
  return [...document.head.querySelectorAll('[data-what-head]')].map((el) => el.getAttribute('data-what-head'));
}

describe('head key escaping', () => {
  it('survives a meta with no name/property (key falls back to JSON)', () => {
    assert.doesNotThrow(() => Head({ meta: { content: 'no-name-here' } }));
    assert.ok(headKeys().some((k) => k.includes('no-name-here')));
  });

  it('survives a crafted key containing selector metacharacters', () => {
    const key = 'x"] , script, [y="';
    assert.doesNotThrow(() => Head({ meta: { name: key, content: 'a' } }));
    assert.equal(document.head.querySelectorAll('meta').length, 2);
  });

  it('dedupes rather than duplicating on a repeated crafted key', () => {
    const key = 'dupe"]{}[';
    Head({ meta: { name: key, content: 'first' } });
    const after = document.head.querySelectorAll('meta').length;
    Head({ meta: { name: key, content: 'second' } });
    assert.equal(document.head.querySelectorAll('meta').length, after, 'must update in place, not append');
    const el = [...document.head.querySelectorAll('meta')].find((m) => m.getAttribute('data-what-head') === key);
    assert.equal(el.getAttribute('content'), 'second');
  });

  it('does not let one key match another entry', () => {
    Head({ meta: { name: 'alpha', content: '1' } });
    Head({ meta: { name: 'alpha-two', content: '2' } });
    const alpha = [...document.head.querySelectorAll('meta')].filter((m) => m.getAttribute('data-what-head') === 'alpha');
    assert.equal(alpha.length, 1);
    assert.equal(alpha[0].getAttribute('content'), '1');
  });
});
