// The errors what-server throws with a catalogue code read in development as
// what-core's do (what-core diagnostics.js _thrownMessage): the code after
// [what], the catalogue's message, then the line naming its fix. A streamed
// render's default onError prints such a message as it is, its code once.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { h, getErrorDefinition } = await import('what-core');
const { renderToString, renderToStream, Form } = await import('../src/index.js');
const { createIslandStore } = await import('../src/islands.js');

const shape = (code, text) => new RegExp(`^\\[what\\] ${code} ${text}[^\\n]*\\n  fix: what_fix\\(\\{ error: "${code}" \\}\\) · `);

function thrown(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected a throw');
}

async function drain(stream) {
  let html = '';
  for await (const chunk of stream) html += chunk;
  return html;
}

describe('what-server errors thrown with a catalogue code', () => {
  it('ERR_INVALID_SSR_TAG, ERR_SSR_INVALID_ID_PREFIX and ERR_FORM_ACTION_MISSING name their code and fix', () => {
    const tag = thrown(() => renderToString(h('bad tag<', {})));
    assert.equal(tag.code, 'ERR_INVALID_SSR_TAG');
    assert.match(tag.message, shape('ERR_INVALID_SSR_TAG', 'Invalid tag name in SSR: "bad tag<"'));
    const prefix = thrown(() => renderToStream(h('p', {}), { idPrefix: '1bad' }));
    assert.equal(prefix.code, 'ERR_SSR_INVALID_ID_PREFIX');
    assert.match(prefix.message, shape('ERR_SSR_INVALID_ID_PREFIX', 'idPrefix "1bad" is not a letter'));
    const form = thrown(() => renderToString(h(Form, {})));
    assert.equal(form.code, 'ERR_FORM_ACTION_MISSING');
    assert.match(form.message, shape('ERR_FORM_ACTION_MISSING', '<Form> requires an `action` prop'));
    for (const error of [tag, prefix, form]) assert.ok(getErrorDefinition(error.code));
  });

  it('ERR_ISLAND_STORE_OUTSIDE_RENDER names its code and fix', () => {
    const store = createIslandStore('cart-outside', { count: 0 });
    const error = thrown(() => store.count);
    assert.equal(error.code, 'ERR_ISLAND_STORE_OUTSIDE_RENDER');
    assert.match(error.message, shape('ERR_ISLAND_STORE_OUTSIDE_RENDER', 'Island store "cart-outside" was accessed outside an active server render\\.'));
  });

  it('a streamed render\'s default onError prints such an error with its code once', async (t) => {
    const errors = t.mock.method(console, 'error', () => {});
    function Bad() { return h('bad tag<', {}); }
    await drain(renderToStream(h('main', {}, h(Bad, {}))));
    const printed = errors.mock.calls.map(({ arguments: args }) => args.join(' ')).find((line) => line.includes('ERR_INVALID_SSR_TAG'));
    assert.ok(printed, 'the error is printed');
    assert.match(printed, /^\[what\] ERR_INVALID_SSR_TAG Invalid tag name/);
    assert.equal(printed.split('ERR_INVALID_SSR_TAG').length - 1, 2, 'the code, and the fix line naming it');
  });
});
