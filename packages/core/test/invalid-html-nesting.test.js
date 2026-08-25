// `<p>a<div>b</div>c</p>` is markup the HTML parser is required to restructure:
// it closes the <p> before the <div>, so one template element becomes four
// top-level nodes. Compiled output then walks firstChild/nextSibling over a tree
// that no longer matches the source and fails with
// `Cannot read properties of null (reading 'firstChild')`, from inside generated
// code, naming nothing the author wrote.
//
// Found by packages/compiler/test/lowering-parity-fuzz.test.js on its first run.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const { _$template } = await import('../src/render.js');

describe('invalid HTML nesting', () => {
  it('names the offending pair instead of dying on a null firstChild', () => {
    assert.throws(
      () => _$template('<p>a<div><!--$--></div>c</p>'),
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
      () => _$template('<p>a<span><div>x</div></span></p>'),
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

  it('leaves the table wrappers alone, which legitimately reparent', () => {
    // <tr> is parsed inside a <table><tbody> wrapper and extracted, so it never
    // reaches the single-root check. Guarding it would have broken every table.
    const build = _$template('<tr><td>a</td></tr>');
    assert.equal(build().nodeName, 'TR');
  });
});
