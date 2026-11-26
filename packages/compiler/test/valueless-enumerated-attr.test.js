// A valueless aria-* or data-* attribute (`<span aria-hidden>`) is `true`,
// and those attributes write true as "true". The DOM target's template wrote
// it as an empty value, while the server target and the runtime wrote "true":
// a compiled client render left aria-hidden="" (no value, so not hidden) and
// hydration rewrote the server's "true" to "" without a report.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';

const SOURCE = 'const a = <div data-shell aria-hidden hidden title="t"><span data-user>{x()}</span></div>;';

function attributes(code) {
  const markup = /_\$template\("([^"]*)"\)|_tmpl\$0 = \["((?:[^"\\]|\\.)*)"/.exec(code);
  const html = (markup[1] ?? markup[2]).replace(/\\"/g, '"');
  const out = {};
  for (const m of html.matchAll(/\s([a-z-]+)(?:=(?:"([^"]*)"|([^\s>]*)))?/g)) out[m[1]] = m[2] ?? m[3] ?? '';
  return out;
}

describe('a valueless aria-* or data-* attribute', () => {
  it('is "true" in the DOM template, as in the server target', () => {
    const dom = attributes(compileJSX(SOURCE));
    const ssr = attributes(compileJSX(SOURCE, { pluginOptions: { generate: 'ssr' } }));
    assert.deepEqual(dom, { 'data-shell': 'true', 'aria-hidden': 'true', hidden: '', title: 't', 'data-user': 'true' });
    assert.deepEqual(dom, ssr);
  });
});
