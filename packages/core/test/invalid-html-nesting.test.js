// `<p>a<div>b</div>c</p>` is markup the HTML parser is required to restructure:
// it closes the <p> before the <div>, so one template element becomes four
// top-level nodes. Compiled output then walks firstChild/nextSibling over a tree
// that no longer matches the source and fails with
// `Cannot read properties of null (reading 'firstChild')`, from inside generated
// code, naming nothing the author wrote.
//
// Found by packages/compiler/test/lowering-parity-fuzz.test.js on its first run.
//
// _$template parses on first use, so the check fires on the first clone rather
// than when the template is defined (at module import).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const { _$template } = await import('../src/render.js');

describe('invalid HTML nesting', () => {
  it('names the offending pair instead of dying on a null firstChild', () => {
    assert.throws(
      () => _$template('<p>a<div><!></div>c</p>')(),
      err => {
        assert.equal(err.code, 'ERR_INVALID_HTML_NESTING');
        assert.match(err.message, /<p> cannot contain <div>/);
        return true;
      },
    );
  });

  it('catches the same class for a nested offender', () => {
    // The <div> is two levels down, inside a <span>, and the parser still
    // closes the <p> — which is exactly why a static parent/child check on the
    // immediate pair would miss it.
    assert.throws(
      () => _$template('<p>a<span><div>x</div></span></p>')(),
      { code: 'ERR_INVALID_HTML_NESTING' },
    );
  });

  it('leaves valid nesting alone', () => {
    const build = _$template('<div>before<div><!--$--></div>after</div>');
    const el = build();
    assert.equal(el.nodeName, 'DIV');
    assert.equal(el.firstChild.data, 'before');
    assert.equal(el.childNodes[1].nodeName, 'DIV');
  });

  it('defers the check to the first clone, so defining a template touches no DOM', () => {
    const build = _$template('<p>a<div>b</div></p>');
    assert.throws(() => build(), { code: 'ERR_INVALID_HTML_NESTING' });
  });

  it('parses table parts at the root without a wrapper', () => {
    // A <template> element parses <tr> and <td> where they stand, so these
    // never reach the single-root check and need no runtime table wrapping.
    const row = _$template('<tr><td>a</td></tr>')();
    assert.equal(row.nodeName, 'TR');
    assert.equal(row.firstChild.nodeName, 'TD');
    assert.equal(_$template('<td>a</td>')().nodeName, 'TD');
  });
});
