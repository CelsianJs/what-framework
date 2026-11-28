// Structural tests for specialized attribute setters.
// The compiler statically classifies attribute names and emits direct
// monomorphic helpers instead of the generic _$setProp dispatcher.
// URL attributes and innerHTML MUST stay on _$setProp (sanitization lives there).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';

describe('C2: specialized attribute setters', () => {
  // The template fixes each element's namespace, so the setter is chosen at
  // compile time: `className` for HTML, the attribute (setClass) for SVG.
  it('class / className → _$className on HTML elements', () => {
    const code = compileJSX(`
      function App() {
        const on = signal(false);
        return <div class={on() ? 'a' : 'b'}><span className={on() ? 'x' : 'y'} /></div>;
      }
    `);
    const calls = code.match(/_\$className\(/g) || [];
    assert.equal(calls.length, 2, `expected 2 _$className calls:\n${code}`);
    assert.doesNotMatch(code, /_\$setClass\(/);
    assert.doesNotMatch(code, /_\$setProp\([^)]*["']class/);
  });

  it('class → _$setClass on SVG elements, including an SVG root outside <svg>', () => {
    const code = compileJSX(`
      function Icon() {
        const on = signal(false);
        return <svg class={on() ? 'a' : 'b'}><g class={on() ? 'x' : 'y'} /></svg>;
      }
      function Part() {
        const on = signal(false);
        return <path class={on() ? 'p' : 'q'} />;
      }
    `);
    const calls = code.match(/_\$setClass\(/g) || [];
    assert.equal(calls.length, 3, `expected 3 _$setClass calls:\n${code}`);
    assert.doesNotMatch(code, /_\$className\(/);
  });

  it('style → _$setStyle', () => {
    const code = compileJSX(`
      function App() {
        const c = signal('red');
        return <div style={{ color: c() }} />;
      }
    `);
    assert.match(code, /_\$setStyle\(/);
    assert.doesNotMatch(code, /_\$setProp\([^)]*["']style/);
  });

  it('data-* and aria-* → _$setAttr', () => {
    const code = compileJSX(`
      function App() {
        const s = signal('on');
        return <div data-state={s()} aria-label={s()} />;
      }
    `);
    const calls = code.match(/_\$setAttr\(/g) || [];
    assert.equal(calls.length, 2, `expected 2 _$setAttr calls:\n${code}`);
  });

  it('input/textarea/select value → _$setValue; checked → _$setChecked', () => {
    const code = compileJSX(`
      function App() {
        const v = signal('');
        const c = signal(false);
        return (
          <form>
            <input value={v()} checked={c()} />
            <textarea value={v()} />
            <select value={v()} />
          </form>
        );
      }
    `);
    const valueCalls = code.match(/_\$setValue\(/g) || [];
    assert.equal(valueCalls.length, 3, `expected 3 _$setValue calls:\n${code}`);
    assert.match(code, /_\$setChecked\([^)]*c\(\)/, 'checked must use the live-property helper');
    assert.doesNotMatch(code, /_\$setProp\([^)]*["']value/);
    assert.doesNotMatch(code, /_\$setProp\([^)]*["']checked/);
  });

  it('value on a NON-form element keeps the generic _$setProp path', () => {
    const code = compileJSX(`
      function App() {
        const n = signal(1);
        return <div value={n()} />;
      }
    `);
    assert.match(code, /_\$setProp\([^)]*["']value["']/);
    assert.doesNotMatch(code, /_\$setValue\(/);
  });

  it('SECURITY: href/src/action/formaction stay on _$setProp (URL sanitization)', () => {
    const code = compileJSX(`
      function App() {
        const u = signal('/x');
        return (
          <div>
            <a href={u()}>a</a>
            <img src={u()} />
            <form action={u()}><button formaction={u()}>b</button></form>
          </div>
        );
      }
    `);
    for (const name of ['href', 'src', 'action', 'formaction']) {
      assert.match(code, new RegExp(`_\\$setProp\\([^)]*["']${name}["']`),
        `${name} must route through _$setProp for sanitization:\n${code}`);
    }
    assert.doesNotMatch(code, /_\$setAttr\([^)]*["'](href|src|action|formaction)["']/);
  });

  it('SECURITY: innerHTML / dangerouslySetInnerHTML stay on _$setProp', () => {
    const code = compileJSX(`
      function App() {
        const h = signal('<b>x</b>');
        return <div innerHTML={h()} dangerouslySetInnerHTML={{ __html: h() }} />;
      }
    `);
    assert.match(code, /_\$setProp\([^)]*["']innerHTML["']/);
    assert.match(code, /_\$setProp\([^)]*["']dangerouslySetInnerHTML["']/);
  });

  it('spreads keep the generic _$spread path', () => {
    const code = compileJSX(`
      function App(props) {
        return <div {...props} />;
      }
    `);
    assert.match(code, /_\$spread\(/);
    assert.doesNotMatch(code, /_\$setClass|_\$setStyle|_\$setAttr|_\$setValue/);
  });

  it('imports each specialized helper only when used', () => {
    const code = compileJSX(`
      function App() {
        const c = signal('x');
        return <div class={c()} />;
      }
    `);
    assert.match(code, /className as _\$className/);
    assert.doesNotMatch(code, /setStyle as|setAttr as|setValue as|setClass as/);
  });
});
