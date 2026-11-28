// A <Show>'s children are its content: text, expressions, elements and
// fragments, in order, on both targets. Only a child that is the sole child
// and a function is a render function. Both targets once treated the first
// expression child as the whole content, dropping the text around it, and
// skipped fragments.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');
const { renderToString } = await import('../../server/src/index.js');
const { flushSync } = await import('../../core/src/reactive.js');

const SOURCE = `
  import { Show, signal } from 'what-framework';
  export const on = signal(true);
  export const text = () => <p><Show when={on()} fallback={<i>no</i>}>Hello {"world"}!</Show></p>;
  export const fragment = () => <p><Show when={on()}><>frag {"ment"}</></Show></p>;
  export const mixed = () => <p><Show when={on()}><b>a</b>{"b"}<i>c</i></Show></p>;
  export const fn = () => <p><Show when={on() && 'v'}>{(v) => <b>{v}</b>}</Show></p>;
`;

const server = await loadCompiled(SOURCE, { pluginOptions: { generate: 'ssr' } });
const client = await loadCompiled(SOURCE);

function mounted(node) {
  const host = document.createElement('div');
  host.append(node);
  flushSync();
  return host.textContent;
}

describe('<Show> content', () => {
  for (const [name, expected] of [['text', 'Hello world!'], ['fragment', 'frag ment'], ['mixed', 'abc'], ['fn', 'v']]) {
    it(`${name}: both targets render "${expected}"`, () => {
      assert.equal(renderToString(server[name]()).replace(/<[^>]+>/g, ''), expected);
      assert.equal(mounted(client[name]()), expected);
    });
  }

  it('the fallback still renders when the condition is false, and the content comes back', () => {
    client.on(false);
    server.on(false);
    const node = client.text();
    const host = document.createElement('div');
    host.append(node);
    flushSync();
    assert.equal(host.textContent, 'no');
    assert.equal(renderToString(server.text()), '<p><i>no</i></p>');
    client.on(true);
    flushSync();
    assert.equal(host.textContent, 'Hello world!');
  });
});
