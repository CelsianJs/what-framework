// An unmounted <Form> retains nothing of a submission whose action is still
// pending: the transition stops waiting for the action's promise when the
// form's owner goes, and nothing resets the form that is gone.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

const { cleanup } = installDOM();
after(cleanup);

const { h, mount, settled } = await import('what-core');
const { Form } = await import('../src/form.js');

async function collectedWithin(ref) {
  for (let attempt = 0; attempt < 12; attempt++) {
    await nextTurn();
    globalThis.gc();
    if (ref.deref() === undefined) return true;
  }
  return false;
}

test('an unmounted Form releases the submitted FormData while its action is pending', async () => {
  const work = withResolvers();
  let ref;
  (() => {
    const host = document.createElement('div');
    const stop = mount(h(Form, {
      action: (data) => {
        ref = new WeakRef(data);
        return work.promise;
      },
    }, h('input', { name: 'note' })), host);
    host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    stop();
  })();
  assert.ok(ref, 'the action received the FormData');
  const released = await collectedWithin(ref);
  work.resolve();
  await settled();
  assert.equal(released, true, 'the FormData of an unmounted form survived 12 collections while its action was pending');
});
