// A server action called on the client is a transition: the RPC, then the
// revalidation it declares (paths through invalidatePath, query keys through
// invalidateQueries), whose refetches join it, so the screen goes from the old
// data to the new in one commit and the optimistic overlay drops in that same
// flush. <Form> runs the same action on submit, with the status
// useFormStatus() reads.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let core;
let data;
let server;
let form;
const posts = [];
let respond = null;
before(async () => {
  env = installDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://shop.test/todos' });
  // The action endpoint: answers when the test says so.
  globalThis.fetch = async (url, init) => {
    posts.push({ url, init, body: JSON.parse(init.body) });
    const answer = await new Promise((resolve) => { respond = resolve; });
    return { ok: answer.ok !== false, status: answer.ok === false ? 500 : 200, json: async () => answer.body };
  };
  core = await import('what-core');
  data = await import('what-core/data');
  server = await import('../src/actions.js');
  form = await import('../src/form.js');
});
after(() => env.cleanup());

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const mounted = [];
function mount(vnode) {
  const el = env.document.createElement('div');
  env.document.body.appendChild(el);
  mounted.push(core.mount(vnode, el));
  return el;
}
afterEach(() => {
  for (const stop of mounted.splice(0)) stop();
  data.clearCache();
  posts.length = 0;
});

// What the page showed after each flush, from an effect that reads it.
function frames(el, read) {
  const seen = [];
  const stop = core.effect(() => { read(); seen.push(el.textContent); });
  return { seen, stop };
}

describe('a server action on the client', () => {
  it('revalidates its query keys inside its transition: overlay, then the new data, nothing between', async () => {
    const lists = [['milk']];
    let fetches = 0;
    const addTodo = server.action(async () => {}, { id: 'addTodo', invalidates: [['todos']] });
    let add;
    let shown;
    const el = mount(core.h(core.Suspense, { fallback: 'loading' }, core.h(() => {
      const todos = data.query(['todos'], async () => { fetches++; return lists.at(-1); });
      [shown, add] = core.useOptimistic(todos, (list, item) => [...list, item + ' (saving)']);
      return core.h('p', null, () => shown().join(','));
    })));
    await core.settled();
    assert.equal(el.textContent, 'milk');

    const watch = frames(el, () => shown());
    const done = core.startTransition(async () => {
      add('eggs');
      await addTodo({ title: 'eggs' });
    });
    await tick();
    assert.equal(el.textContent, 'milk,eggs (saving)');
    assert.deepEqual(posts.map((p) => p.body), [{ args: [{ title: 'eggs' }] }]);
    assert.equal(posts[0].init.headers['X-What-Action'], 'addTodo');

    lists.push(['milk', 'eggs']);
    respond({ body: { ok: true } });
    await done;
    await core.settled();
    watch.stop();
    assert.equal(fetches, 2, 'the action refetched the list');
    assert.equal(el.textContent, 'milk,eggs');
    // The first frame is the one before the action.
    assert.deepEqual(watch.seen, ['milk', 'milk,eggs (saving)', 'milk,eggs'], 'no frame back to the old list in between');
  });

  it('revalidates a path: what was read on it refetches', async () => {
    let fetches = 0;
    const save = server.action(async () => {}, { id: 'save', revalidate: ['/todos'] });
    mount(core.h(core.Suspense, { fallback: 'loading' }, core.h(() => {
      const count = data.query(['count'], async () => ++fetches);
      return core.h('p', null, () => String(count()));
    })));
    await core.settled();
    const done = save();
    await tick();
    respond({ body: null });
    await done;
    assert.equal(fetches, 2, 'the query read on /todos was refetched before the action resolved');
  });

  it('rejects with the action\'s error, and the overlay rolls back', async () => {
    const fail = server.action(async () => {}, { id: 'fail' });
    let add;
    const el = mount(core.h(() => {
      const [shown, addOptimistic] = core.useOptimistic(0, (n, by) => n + by);
      add = addOptimistic;
      return core.h('p', null, () => String(shown()));
    }));
    let error = null;
    const done = core.startTransition(async () => {
      add(1);
      try {
        await fail();
      } catch (e) {
        error = e;
      }
    });
    await tick();
    assert.equal(el.textContent, '1');
    respond({ ok: false, body: { message: 'Action failed' } });
    await done;
    await tick();
    assert.equal(error && error.code, 'ERR_ACTION_FAILED');
    assert.equal(el.textContent, '0');
  });
});

describe('<Form> on a mounted page', () => {
  it('runs the server action with the fields, shows the submission, and resets the form', async () => {
    const save = server.action(async () => {}, { id: 'savePost' });
    function SubmitButton() {
      const status = core.useFormStatus();
      return core.h('button', { type: 'submit' }, () => (status.pending() ? `saving ${status.data().get('title')}` : 'save'));
    }
    const el = mount(core.h(form.Form, { action: save }, core.h('input', { name: 'title', value: 'hello' }), core.h(SubmitButton)));
    const formEl = el.querySelector('form');
    assert.equal(formEl.getAttribute('action'), '/__what_action');
    formEl.dispatchEvent(new env.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    assert.equal(el.querySelector('button').textContent, 'saving hello');
    assert.deepEqual(posts[0].body, { args: [{ title: 'hello' }] }, 'the endpoint fields are not passed on');
    respond({ body: { ok: true } });
    await core.settled();
    assert.equal(el.querySelector('button').textContent, 'save');
  });

  it('runs a client action (useActionState\'s dispatch) with the FormData', async () => {
    let state;
    const el = mount(core.h(() => {
      const [message, dispatch] = core.useActionState(async (_, fd) => `hi ${fd.get('name')}`, '');
      state = message;
      return core.h(form.Form, { action: dispatch }, core.h('input', { name: 'name', value: 'ada' }));
    }));
    el.querySelector('form').dispatchEvent(new env.window.Event('submit', { bubbles: true, cancelable: true }));
    await core.settled();
    assert.equal(state(), 'hi ada');
    assert.equal(posts.length, 0, 'a client action posts nothing');
  });
});
