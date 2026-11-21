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

  it('keeps what was typed while a useActionState submission is pending, resets it once the action succeeded, keeps it when it failed', async () => {
    const gates = [];
    let status;
    function Submit() {
      status = core.useFormStatus();
      return core.h('button', { type: 'submit' }, 'save');
    }
    const el = mount(core.h(core.ErrorBoundary, { fallback: ({ error }) => error.message }, core.h(() => {
      const [, dispatch] = core.useActionState(() => {
        const gate = Promise.withResolvers();
        gates.push(gate);
        return gate.promise;
      }, null);
      return core.h(form.Form, { action: dispatch }, core.h('input', { name: 'title' }), core.h(Submit));
    })));
    const input = el.querySelector('input');
    const submit = () => el.querySelector('form').dispatchEvent(new env.window.Event('submit', { bubbles: true, cancelable: true }));
    input.value = 'first draft';
    submit();
    await tick();
    assert.deepEqual([status.pending(), status.data().get('title'), input.value], [true, 'first draft', 'first draft'], 'pending: the draft stays');
    gates[0].resolve('saved');
    await core.settled();
    assert.deepEqual([status.pending(), input.value], [false, ''], 'succeeded: reset at the commit');
    input.value = 'second draft';
    submit();
    await tick();
    gates[1].reject(new Error('save failed'));
    await core.settled();
    assert.deepEqual([el.textContent, input.value], ['save failed', 'second draft'], 'failed: the boundary shows it, and the draft stays');
  });

  it('keeps what was typed when the server action fails, and reports it as form:error', async () => {
    const save = server.action(async () => {}, { id: 'failingSave' });
    const el = mount(core.h(form.Form, { action: save }, core.h('input', { name: 'title' })));
    const formEl = el.querySelector('form');
    const errors = [];
    formEl.addEventListener('form:error', (event) => errors.push(event.detail.error));
    el.querySelector('input').value = 'draft';
    formEl.dispatchEvent(new env.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    respond({ ok: false, body: { error: 'nope' } });
    await core.settled();
    await tick();
    assert.equal(errors.length, 1);
    assert.equal(el.querySelector('input').value, 'draft');
  });

  it('a field named like a built-in reaches the server action as its own field', async () => {
    const save = server.action(async () => {}, { id: 'builtinNames' });
    const el = mount(core.h(form.Form, { action: save }, core.h('input', { name: 'constructor', value: 'x' }), core.h('input', { name: 'toString', value: 'y' })));
    el.querySelector('form').dispatchEvent(new env.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    assert.deepEqual(posts[0].body, { args: [{ constructor: 'x', toString: 'y' }] });
    respond({ body: { ok: true } });
    await core.settled();
  });

  it('useFormStatus().action is the action function, or null for an action id, as in React', () => {
    const save = server.action(async () => {}, { id: 'statusSave' });
    const seen = [];
    function Probe() {
      seen.push(core.useFormStatus().action);
      return null;
    }
    mount(core.h(form.Form, { action: save }, core.h(Probe)));
    mount(core.h(form.Form, { action: 'statusSave' }, core.h(Probe)));
    assert.deepEqual(seen, [save, null]);
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

describe('<Form> in a server-rendered page', () => {
  it('hydrates with an <ErrorBoundary> after it: no mismatch, the server nodes are kept', async () => {
    const { renderToHydratableString } = await import('../src/index.js');
    const Child = () => core.h('p', { id: 'c' }, () => 'fine');
    const tree = () => core.h('main', {},
      core.h(form.Form, { action: 'saveDraft', id: 'f' }, core.h('button', {}, 'go')),
      core.h(core.ErrorBoundary, { fallback: () => core.h('p', {}, 'err') }, core.h(Child)));
    const el = env.document.createElement('div');
    env.document.body.appendChild(el);
    el.innerHTML = renderToHydratableString(tree());
    const server = [el.querySelector('form'), el.querySelector('#c')];
    const reports = [];
    mounted.push(core.hydrate(tree(), el, { onHydrationError: (r) => reports.push(r) }));
    assert.deepEqual(reports, []);
    assert.deepEqual([el.querySelector('form'), el.querySelector('#c')], server);
  });
});
