// What an island is handed, on both targets. Island props are serialized to
// JSON for the browser, so JSX is not a prop: it is refused where it is written
// (ERR_JSX_ISLAND_PROP), on the client build and the server build alike, rather
// than serialized as an empty object. And `client:media` takes its query from
// an expression as well as from a string.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const TARGETS = ['dom', 'ssr'];
const compile = (source, generate) => compileJSX(source, { filename: '/app/src/Page.jsx', pluginOptions: { generate } });

describe('islands: JSX is not a prop', () => {
  for (const generate of TARGETS) {
    it(`${generate}: JSX in a prop's value is a compile error naming the prop and the island`, () => {
      for (const value of ['{<b>{n}</b>}', '{ok ? <b /> : null}', '{[<i />]}', '{{ icon: <b /> }}', '<b />']) {
        let error = null;
        try {
          compile(`const a = <Chart client:load label="x" icon=${value} />;`, generate);
        } catch (e) {
          error = e;
        }
        assert.ok(error, `icon=${value} compiled`);
        assert.equal(error.code, 'ERR_JSX_ISLAND_PROP');
        assert.match(error.message, /"icon" of <Chart>/);
        assert.match(error.message, /ERR_JSX_ISLAND_PROP at \/app\/src\/Page\.jsx:1:\d+/);
      }
    });

    it(`${generate}: an inline object spread is checked key by key`, () => {
      assert.throws(() => compile('const a = <Chart client:idle {...{ icon: <b /> }} />;', generate), (e) => e.code === 'ERR_JSX_ISLAND_PROP' && /"icon"/.test(e.message));
    });

    it(`${generate}: JSX inside a function prop, and JSX as a child, are fine`, () => {
      assert.doesNotThrow(() => compile('const a = <Chart client:load render={() => <b />}><i>child</i></Chart>;', generate));
      assert.doesNotThrow(() => compile('const a = <Card icon={<b />} />;', generate), 'a component that is not an island takes JSX props');
    });
  }
});

describe('islands: client:media={expression}', () => {
  for (const generate of TARGETS) {
    it(`${generate}: the expression is the media query`, () => {
      const code = compile('const q = "(min-width: 40em)"; const a = <Chart client:media={q} />;', generate);
      assert.match(code, /mode: "media",\s*mediaQuery: q/);
      assert.match(compile('const a = <Chart client:media="(min-width: 40em)" />;', generate), /mediaQuery: "\(min-width: 40em\)"/);
    });
  }

  it('the server renders the island with the query it was given', async () => {
    const { renderToString } = await import('../../server/src/index.js');
    globalThis.__chartForMedia = function Chart() { return null; };
    const mod = await loadCompiled('const Chart = globalThis.__chartForMedia; export const a = (q) => <div><Chart client:media={q} /></div>;', { pluginOptions: { generate: 'ssr' } });
    assert.match(renderToString(mod.a('(min-width: 40em)')), /data-island-mode="media"/);
  });
});
