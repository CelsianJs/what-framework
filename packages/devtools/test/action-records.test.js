import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
const core = await import('what-core/internal');
const { action, Form } = await import('what-framework/server');
const { h, mount, ErrorBoundary, useActionState, settled } = await import('what-framework');
const { setQueryData } = await import('what-framework/data');
const { installDevTools, subscribe } = await import('../src/index.js');

test('server action completions report matched query keys, paths and failures', async (t) => {
  installDevTools(core);
  const events = [];
  t.after(subscribe((event, data) => { if (event === 'action') events.push(data); }));
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }));
  setQueryData(['todos', 1], ['existing']);
  setQueryData(['todos-other'], ['untouched']);

  const add = action(async function addTodo() {}, {
    id: 'add', revalidate: ['/todos'], invalidates: [['todos'], ['no-match']],
  });
  await add();
  const save = action(async () => {}, { id: 'save' });
  await save();
  fetch.mock.mockImplementation(async () => Response.json({ message: 'denied' }, { status: 403 }));
  await assert.rejects(add(), { code: 'ERR_ACTION_FAILED' });
  assert.deepEqual(events, [
    { name: 'addTodo', outcome: 'ok', invalidated: ['todos:1'], revalidated: ['/todos'] },
    { name: 'save', outcome: 'ok', invalidated: [], revalidated: [] },
    { name: 'addTodo', outcome: 'error', invalidated: [], revalidated: [] },
  ]);
});

// A server action dispatched by useActionState from a <Form>: the action event
// the devtools see and whether the form resets come from two places (the RPC
// in what-server, the dispatch in what-core) and must tell the same story.
test('a <Form> submitting through useActionState: the action event and the reset agree', async (t) => {
  installDevTools(core);
  const events = [];
  t.after(subscribe((event, data) => { if (event === 'action') events.push(data); }));
  let allowed = true;
  t.mock.method(globalThis, 'fetch', async () => (allowed
    ? Response.json({ saved: true })
    : Response.json({ message: 'denied' }, { status: 403 })));
  setQueryData(['drafts'], []);
  const saveDraft = action(async function saveDraft() {}, { id: 'saveDraft', invalidates: [['drafts']] });

  const root = document.createElement('div');
  document.body.appendChild(root);
  t.after(mount(h(ErrorBoundary, { fallback: ({ error }) => h('p', {}, error.code) }, h(() => {
    const [, dispatch] = useActionState((previous, fields) => saveDraft(fields.get('title')), null);
    return h(Form, { action: dispatch }, h('input', { name: 'title' }));
  })), root));
  const input = root.querySelector('input');
  const submit = () => root.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

  input.value = 'first draft';
  submit();
  await settled();
  assert.deepEqual(events.at(-1), { name: 'saveDraft', outcome: 'ok', invalidated: ['drafts'], revalidated: [] });
  assert.equal(input.value, '', 'reset at the commit of a submission that succeeded');

  allowed = false;
  input.value = 'second draft';
  submit();
  await settled();
  assert.deepEqual(events.at(-1), { name: 'saveDraft', outcome: 'error', invalidated: [], revalidated: [] });
  assert.equal(input.value, 'second draft', 'a failed submission keeps what was typed');
  assert.equal(root.textContent, 'ERR_ACTION_FAILED');
});
