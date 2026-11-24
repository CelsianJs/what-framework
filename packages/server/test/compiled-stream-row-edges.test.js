// The stream, compiled markup, and a keyed row that is cut short.
//
// A keyed row of compiled markup is rendered between two edges (ssr-runtime's
// RowEdge), which enter and leave the row in the frame that renders the
// markup: the components a row renders take their place in it, and a
// useActionState key is that place (what-core hydration-data.js _enterRow).
// When a child of a row fails where the stream places it, the stream closes
// the rest of that component's markup without rendering it (stream.js
// handleError, Markup.pour with `skip`). The edges of the rows it skips still
// have to run: the failed row has to be left. A frame that renders in its
// parent's output (a built-in what-compiler lowers away, run as a component)
// shares the parent's rows, so a row left open there would hold every
// component the parent renders after it.
//
// This file defines a server action, which makes every renderer of its
// process track rows: it stays apart from compiled-stream-flow.test.js.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { collect, content } from './stream-helpers.js';

const { h } = await import('what-core');
const { renderToStream } = await import('../src/index.js');

const mod = await loadCompiled(`
  import { Show, useActionState } from 'what-framework';
  import { Form } from ${JSON.stringify(import.meta.resolve('../src/index.js'))};
  import { rename } from ${JSON.stringify(import.meta.resolve('./fixtures/keyed-rename.js'))};

  // <Show> under another name is a component the compiler does not lower: it
  // renders in the output of the component that places it.
  const Gate = Show;

  function Editor({ record }) {
    const [state, save] = useActionState(rename, null);
    return <Form action={save} data-form={record.key}><input name="title" /></Form>;
  }

  function Table({ rows }) {
    return <ol>{rows.map((r) => <li key={r.key}><Editor record={r} /></li>)}</ol>;
  }

  export function Page({ list, bad, child }) {
    return (
      <main>
        <Gate when={true}>
          <ul>{list.map((r) => <li key={r.key}>{r.key === bad ? child : <b>{r.key}</b>}<Editor record={r} /><i>after</i></li>)}</ul>
        </Gate>
        <Table rows={list} />
      </main>
    );
  }
`, { pluginOptions: { generate: 'ssr' } });

const list = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];

// Each form's record and the place its useActionState key names: the key
// without the render's salt and the digests taken under it (a list's place
// ends at a `.`, which nothing else in a place writes, before the eleven
// digits of the row's key).
function places(html) {
  return [...html.matchAll(/<form[^>]*data-form="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g)].map(([, id, inner]) => {
    const key = /name="_actionKey" value="([^"]*)"/.exec(inner);
    assert.ok(key, 'a form without a key: ' + inner);
    return id + ' ' + key[1].replace(/^[^/]*\//, '').replace(/\.[\s\S]{11}/g, '.#');
  });
}

const streamed = (props) => collect(renderToStream(h(mod.Page, props), { onError: () => {} }));

describe('the stream leaves the keyed rows it cuts short', () => {
  it('a child that fails in a keyed row: the forms after it keep the keys they have when nothing fails', async () => {
    const whole = await streamed({ list, bad: null, child: null });
    const wholePlaces = places(whole);
    assert.equal(wholePlaces.length, 6);
    // The rows of the first list and of the table are different places.
    assert.equal(new Set(wholePlaces.map((place) => place.replace(/^\S+ /, ''))).size, 2, wholePlaces.join('\n'));

    for (const bad of ['a', 'b', 'c']) {
      // A tag no renderer writes: the stream throws where it places it, in
      // the row of `bad`.
      const cut = await streamed({ list, bad, child: h('bad tag', null) });
      const before = list.findIndex((r) => r.key === bad);
      assert.match(content(cut), /<\/ul><!-- SSR Error --><ol>/, cut);
      // The rows before the failed one rendered their forms; the table's
      // forms are where they are when no row fails.
      assert.deepEqual(places(cut), [...wholePlaces.slice(0, before), ...wholePlaces.slice(3)], `the row of ${bad} failed`);
    }
  });
});
