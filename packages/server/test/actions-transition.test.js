// A server action called on the client is a transition: the RPC, then the
// revalidation it declares (paths through invalidatePath, query keys through
// invalidateQueries), whose refetches join it, so the screen goes from the old
// data to the new in one commit and the optimistic overlay drops in that same
// flush. <Form> runs the same action on submit, with the status
// useFormStatus() reads.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

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
    const json = async () => {
      if (answer.html !== undefined) throw new SyntaxError(`Unexpected token '<', "${answer.html.slice(0, 9)}"... is not valid JSON`);
      return answer.body;
    };
    return { ok: answer.ok !== false, status: answer.status ?? (answer.ok === false ? 500 : 200), headers: new Headers(), json };
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
    assert.equal(error.status, 500);
    assert.equal(el.textContent, '0');
  });

  // A body over the server's bodyLimit: what the visitor's code can tell
  // apart and show, with the limit the server sent.
  it('rejects a call the server refused as too large with ERR_PAYLOAD_TOO_LARGE, its status and the limit', async () => {
    const big = server.action(async () => {}, { id: 'too-large' });
    let error = null;
    const done = big('x').catch((e) => { error = e; });
    await tick();
    respond({ ok: false, status: 413, body: { message: 'Payload too large', code: 'ERR_PAYLOAD_TOO_LARGE', limit: 1048576 } });
    await done;
    assert.equal(error && error.code, 'ERR_PAYLOAD_TOO_LARGE');
    assert.equal(error.status, 413);
    assert.equal(error.limit, 1048576);
    assert.match(error.message, /1048576 bytes/);
    const refused = server.action(async () => {}, { id: 'refused' });
    const second = refused().catch((e) => { error = e; });
    await tick();
    respond({ ok: false, status: 403, body: { message: 'Invalid CSRF token' } });
    await second;
    assert.deepEqual([error.code, error.status, error.message], ['ERR_ACTION_FAILED', 403, 'Invalid CSRF token']);
  });

  // A refusal whose body is not the framework's JSON (a proxy's page, null, a
  // number, a message that is no string) still rejects with the coded error
  // and its status, never a TypeError reading the body.
  it('rejects any refusal with the coded error, whatever its body holds', async () => {
    const call = server.action(async () => {}, { id: 'refused-bodies' });
    const answers = [
      [{ ok: false, status: 413, html: '<html><body>413 Request Entity Too Large</body></html>' }, ['ERR_PAYLOAD_TOO_LARGE', 413, undefined, 'Payload too large: the server accepts less in one request']],
      [{ ok: false, status: 413, body: null }, ['ERR_PAYLOAD_TOO_LARGE', 413, undefined, 'Payload too large: the server accepts less in one request']],
      [{ ok: false, status: 400, body: null }, ['ERR_ACTION_FAILED', 400, undefined, 'Action failed']],
      [{ ok: false, status: 502, html: '<html>Bad Gateway</html>' }, ['ERR_ACTION_FAILED', 502, undefined, 'Action failed']],
      [{ ok: false, status: 400, body: 7 }, ['ERR_ACTION_FAILED', 400, undefined, 'Action failed']],
      [{ ok: false, status: 400, body: { message: { html: '<b>x</b>' } } }, ['ERR_ACTION_FAILED', 400, undefined, 'Action failed']],
    ];
    for (const [answer, expected] of answers) {
      let error = null;
      const done = call().catch((e) => { error = e; });
      await tick();
      respond(answer);
      await done;
      assert.deepEqual([error.code, error.status, error.limit, error.message], expected, JSON.stringify(answer));
    }
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
        const gate = withResolvers();
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

describe('<Form> resets as React 19 resets a form, after its action succeeded', () => {
  const submit = (formEl) => formEl.dispatchEvent(new env.window.Event('submit', { bubbles: true, cancelable: true }));
  const succeed = async () => {};

  it('clears the uncontrolled fields; a controlled one keeps what its prop holds', async () => {
    const text = core.signal('controlled');
    const pick = core.signal('b');
    const note = core.signal('kept note');
    const el = mount(core.h(form.Form, { action: succeed },
      core.h('input', { name: 'free' }),
      core.h('input', { name: 'text', value: text }),
      core.h('select', { name: 'pick', value: pick }, core.h('option', { value: 'a' }, 'a'), core.h('option', { value: 'b' }, 'b')),
      core.h('textarea', { name: 'note', value: note })));
    const [free, controlled] = el.querySelectorAll('input');
    text('changed');
    await core.settled();
    free.value = 'draft';
    controlled.value = 'typed over the prop';
    submit(el.querySelector('form'));
    await core.settled();
    assert.deepEqual([free.value, controlled.value, el.querySelector('select').value, el.querySelector('textarea').value], ['', 'changed', 'b', 'kept note']);
    text('after');
    await core.settled();
    assert.equal(controlled.value, 'after', 'the binding goes on');
  });

  it('the same for compiled fields: value, checked and a select', async () => {
    const { loadCompiled } = await import('../../../test-utils/load-compiled.js');
    const app = await loadCompiled(`
      import { signal } from 'what-framework';
      export const text = signal('controlled');
      export const on = signal(true);
      export const pick = signal('y');
      export function View({ Form, act }) {
        return <Form action={act}>
          <input name="free" />
          <input name="text" value={text()} />
          <input type="checkbox" name="box" checked={on()} />
          <select name="pick" value={pick()}><option value="x">x</option><option value="y">y</option></select>
        </Form>;
      }`);
    const el = mount(core.h(app.View, { Form: form.Form, act: succeed }));
    const [free, controlled, box] = el.querySelectorAll('input');
    free.value = 'draft';
    controlled.value = 'typed';
    box.checked = false;
    el.querySelector('select').value = 'x';
    submit(el.querySelector('form'));
    await core.settled();
    assert.deepEqual([free.value, controlled.value, box.checked, el.querySelector('select').value], ['', 'controlled', true, 'y']);
  });

  it('resets a form whose controls are named reset and elements', async () => {
    const el = mount(core.h(form.Form, { action: succeed }, core.h('input', { name: 'reset' }), core.h('input', { name: 'elements' })));
    const formEl = el.querySelector('form');
    const [reset, elements] = el.querySelectorAll('input');
    // JSDOM has no [LegacyOverrideBuiltIns] named getter: model the browser's,
    // where each control shadows the form's own member of its name.
    Object.defineProperty(formEl, 'reset', { value: reset });
    Object.defineProperty(formEl, 'elements', { value: elements });
    const errors = [];
    formEl.addEventListener('form:error', (event) => errors.push(event.detail.error));
    reset.value = 'draft';
    elements.value = 'draft';
    submit(formEl);
    await core.settled();
    assert.deepEqual([reset.value, elements.value, errors], ['', '', []]);
  });

  it('a reset that throws is the form\'s form:error, and the commit still completes', async () => {
    let status;
    const text = core.signal('controlled');
    const el = mount(core.h(form.Form, { action: succeed },
      core.h('input', { name: 'text', value: text }),
      core.h(() => { status = core.useFormStatus(); return null; })));
    const formEl = el.querySelector('form');
    const input = el.querySelector('input');
    Object.defineProperty(input, 'value', { configurable: true, get: () => 'x', set() { throw new Error('cannot write'); } });
    const errors = [];
    formEl.addEventListener('form:error', (event) => errors.push(event.detail.error.message));
    submit(formEl);
    await core.settled();
    assert.deepEqual(errors, ['cannot write']);
    assert.deepEqual([status.pending(), status.data()], [false, null], 'the transition committed');
  });

  it('useFormStatus shows the submission still pending when a later one commits first', async () => {
    const flights = [];
    let status;
    const el = mount(core.h(form.Form, { action: () => {
      const work = withResolvers();
      flights.push(work);
      return work.promise;
    } }, core.h('input', { name: 'title' }), core.h(() => { status = core.useFormStatus(); return null; })));
    const formEl = el.querySelector('form');
    const input = el.querySelector('input');
    const seen = () => [status.pending(), status.data() && status.data().get('title')];
    input.value = 'older';
    submit(formEl);
    input.value = 'newer';
    submit(formEl);
    assert.deepEqual(seen(), [true, 'newer']);
    flights[1].resolve();
    await tick();
    assert.deepEqual(seen(), [true, 'older']);
    flights[0].resolve();
    await core.settled();
    assert.deepEqual(seen(), [false, null]);
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
