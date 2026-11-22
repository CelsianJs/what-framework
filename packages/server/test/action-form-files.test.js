// A sign-up form with an avatar, as the edit-form pattern teaches it:
//
//   const [state, save] = useActionState(signup, null);
//   <Form action={save} enctype="multipart/form-data">
//     <input name="email" /> <input type="file" name="avatar" />
//   </Form>
//
// A server action receives exactly what the form holds, its files included,
// with and without JavaScript: a no-JS post is multipart/form-data, which the
// action endpoint and the page post read (the platform's FormData parser,
// under `bodyLimit`) into the fields an urlencoded post gives, a file as a Web
// File; the action client sends a call whose fields hold a file as that same
// form. Before, the page post read only urlencoded bodies (the page rendered
// again and the action never ran) and the client sent the file as JSON, `{}`.
// A file is never sent back: in what an action returns it is null, with and
// without JavaScript, so the state and its `_state` round-trip carry none.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { h, useActionState, getResponse } = await import('what-core');
const { Form, action, createRequestHandler, createFormPostHandler, nodeActionMiddleware, fetchActionHandler } = await import('../src/index.js');
const { toNodeListener } = await import('../src/node.js');
const { _callAction } = await import('../src/actions.js');

const calls = [];
const signup = action(async (previous, fields) => {
  calls.push({ previous, fields });
  const avatar = fields.avatar;
  const upload = avatar instanceof File ? { name: avatar.name, size: avatar.size, type: avatar.type, text: await avatar.text() } : null;
  if (!String(fields.email ?? '').includes('@')) return { error: 'Enter a valid email', fields: { email: fields.email }, upload };
  getResponse().redirect('/welcome');
  return { saved: true };
}, { id: 'files/signup' });

// A server action's own form (`<Form action={join}>`), called with the fields
// alone; posted by its id here.
action(async (fields) => {
  calls.push({ fields });
  const upload = fields.avatar instanceof File ? { name: fields.avatar.name, size: fields.avatar.size } : null;
  if (!String(fields.email ?? '').includes('@')) return { error: 'Enter a valid email', upload };
  getResponse().redirect('/welcome');
  return { saved: true, upload };
}, { id: 'files/join' });

// The fields echoed back whole, the avatar with them.
const echo = action(async (previous, fields) => {
  calls.push({ previous, fields });
  return { error: 'Try again', fields, list: [fields.avatar, 'kept'] };
}, { id: 'files/echo' });

function SignupPage({ act = signup }) {
  const [state, save] = useActionState(act, null);
  return h('main', null, h(Form, { action: save, enctype: 'multipart/form-data' },
    h('input', { name: 'email', defaultValue: () => state()?.fields?.email ?? '' }),
    h('input', { type: 'file', name: 'avatar' }),
    () => (state()?.error ? h('p', { role: 'alert' }, state().error) : null),
    () => (state()?.upload ? h('output', null, JSON.stringify(state().upload)) : null),
    h('button', { type: 'submit' }, 'Create account')));
}

const origin = 'http://files.test';
const avatar = () => new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'avatar.svg', { type: 'image/svg+xml' });
const handlerFor = (component, page, extra = {}) => createRequestHandler({ routes: [{ path: '/', component, page }], ...extra });
const field = (html, name) => (new RegExp(`name="${name}" value="([^"]*)"`).exec(html) || [])[1];
const unescape = (text) => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// The page's form as a browser posts it without JavaScript: multipart, its
// hidden fields as the page wrote them, then `fields`.
async function postPage(handle, fields) {
  const page = await (await handle(new Request(`${origin}/`))).text();
  const body = new FormData();
  for (const name of ['_action', '_state', '_actionKey']) body.append(name, unescape(field(page, name)));
  for (const [name, value] of fields) body.append(name, value);
  return handle(new Request(`${origin}/`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', accept: 'text/html' }, body }));
}

describe('a form with a file, posted without JavaScript', () => {
  for (const [renderer, page] of [['the stream', { mode: 'server' }], ['the buffered render', { mode: 'server', stream: false }]]) {
    it(`to its page: the action gets the file, the page renders its state (${renderer})`, async () => {
      calls.length = 0;
      const handle = handlerFor(SignupPage, page);
      const res = await postPage(handle, [['email', 'typo'], ['avatar', avatar()], ['tag', 'a'], ['tag', 'b']]);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'private, no-store');
      const html = await res.text();
      assert.match(html, /role="alert">Enter a valid email</);
      assert.match(html, /<input name="email" value="typo">/);
      const shown = JSON.parse(unescape(/<output>([^<]*)<\/output>/.exec(html)[1]));
      assert.deepEqual(shown, { name: 'avatar.svg', size: 41, type: 'image/svg+xml', text: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].previous, null);
      assert.ok(calls[0].fields.avatar instanceof File);
      assert.deepEqual(calls[0].fields.tag, ['a', 'b'], 'a repeated name is an array');
      assert.deepEqual(Object.keys(calls[0].fields), ['email', 'avatar', 'tag'], 'no reserved field');
      const ok = await postPage(handle, [['email', 'name@example.test'], ['avatar', avatar()]]);
      assert.equal(ok.status, 303);
      assert.equal(ok.headers.get('location'), '/welcome');
    });
  }

  it('to the action endpoint: 303, and the action gets the file', async () => {
    calls.length = 0;
    const handle = handlerFor(SignupPage, { mode: 'server' });
    const body = new FormData();
    body.append('_action', 'files/join');
    body.append('_redirect', '/');
    body.append('email', 'name@example.test');
    body.append('avatar', avatar());
    const res = await handle(new Request(`${origin}/__what_action`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body }));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/welcome');
    assert.equal(await calls[0].fields.avatar.text(), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  });

  it('keeps the rules of an urlencoded post: a cross-site multipart post is refused, a reserved field never reaches the action', async () => {
    calls.length = 0;
    const handle = handlerFor(SignupPage, { mode: 'server' });
    const body = () => {
      const form = new FormData();
      form.append('_action', 'files/signup');
      form.append('_redirect', '/');
      form.append('email', 'name@example.test');
      form.append('_state', new File(['{}'], 'state.json'));
      return form;
    };
    const cross = await handle(new Request(`${origin}/__what_action`, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' }, body: body() }));
    assert.equal(cross.status, 403);
    const asFile = await handle(new Request(`${origin}/__what_action`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: body() }));
    assert.equal(asFile.status, 400, 'a state sent as a file is no state');
    assert.equal(calls.length, 0);
  });

  it('a file in what the action returns is null: in the page, its data and the `_state` it posts next', async () => {
    calls.length = 0;
    const handle = handlerFor(() => h(SignupPage, { act: echo }), { mode: 'server', stream: false });
    const res = await postPage(handle, [['email', 'typo'], ['avatar', avatar()]]);
    const html = await res.text();
    const state = JSON.parse(unescape(field(html, '_state')));
    assert.deepEqual(state, { error: 'Try again', fields: { email: 'typo', avatar: null }, list: [null, 'kept'] });
    assert.doesNotMatch(html, /svg xmlns/, 'no byte of the file is in the page');
  });
});

describe('a form with a file, with JavaScript: the action client', () => {
  // The browser's fetch, answered by the request handler.
  async function withFetch(handle, run) {
    const sent = [];
    const before = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const request = new Request(origin + url, init);
      sent.push(request.clone());
      request.headers.set('sec-fetch-site', 'same-origin');
      return handle(new Request(request, { headers: request.headers }));
    };
    try {
      return { result: await run(), sent };
    } finally {
      globalThis.fetch = before;
    }
  }

  it('sends a call whose fields hold a file as their form, multipart, with the state as `_state`', async () => {
    calls.length = 0;
    const handle = handlerFor(SignupPage, { mode: 'server' });
    const previous = { error: 'Enter a valid email', fields: { email: 'typo' } };
    const { result, sent } = await withFetch(handle, () => _callAction('files/echo', [previous, { email: 'typo', avatar: avatar(), tag: ['a', 'b'] }]));
    assert.match(sent[0].headers.get('content-type'), /^multipart\/form-data; boundary=/);
    assert.equal(sent[0].headers.get('x-what-action'), 'files/echo');
    const form = await sent[0].formData();
    assert.equal(form.get('_state'), JSON.stringify(previous));
    assert.deepEqual(calls[0].previous, previous);
    assert.ok(calls[0].fields.avatar instanceof File);
    assert.equal(await calls[0].fields.avatar.text(), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.deepEqual(calls[0].fields.tag, ['a', 'b']);
    assert.deepEqual(result, { error: 'Try again', fields: { email: 'typo', avatar: null, tag: ['a', 'b'] }, list: [null, 'kept'] });
  });

  it('sends a call with no file, and one that is not a form\'s fields, as JSON', async () => {
    const handle = handlerFor(SignupPage, { mode: 'server' });
    const { sent } = await withFetch(handle, async () => {
      await _callAction('files/echo', [null, { email: 'typo' }]);
      await _callAction('files/echo', [null, { email: 'typo', count: 3, avatar: avatar() }]);
    });
    assert.deepEqual(sent.map((r) => r.headers.get('content-type')), ['application/json', 'application/json']);
  });
});

describe('a custom server, a middleware and a fetch endpoint', () => {
  it('createFormPostHandler reads a multipart request itself when no body is passed, under its bodyLimit', async () => {
    calls.length = 0;
    const run = createFormPostHandler({ skipCsrf: true, bodyLimit: 4096 });
    const body = new FormData();
    body.append('_action', 'files/join');
    body.append('email', 'typo');
    body.append('avatar', avatar());
    const request = new Request(`${origin}/`, { method: 'POST', body });
    const posted = await run({ method: 'POST', headers: Object.fromEntries(request.headers), url: request.url, request });
    assert.equal(posted.actionState.state.upload.name, 'avatar.svg');
    assert.equal(await request.formData().then((f) => f.get('email')), 'typo', 'the request\'s own body is unread');
    const big = new FormData();
    big.append('_action', 'files/join');
    big.append('avatar', new File(['x'.repeat(5000)], 'big.bin'));
    const large = new Request(`${origin}/`, { method: 'POST', body: big });
    const refused = await run({ method: 'POST', headers: Object.fromEntries(large.headers), url: large.url, request: large });
    assert.equal(refused.response.status, 413);
    assert.match(refused.response.headers['content-type'], /text\/html/);
    const plain = new Request(`${origin}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(await run({ method: 'POST', headers: {}, url: plain.url, request: plain }), null, 'not a form');
  });

  it('nodeActionMiddleware reads a multipart post, and its 413 reaches the client', async () => {
    calls.length = 0;
    const mw = nodeActionMiddleware({ skipCsrf: true, bodyLimit: 4096 });
    const server = http.createServer((req, res) => mw(req, res, () => { res.writeHead(404); res.end(); }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const at = `http://127.0.0.1:${server.address().port}/__what_action`;
    try {
      const body = new FormData();
      body.append('_action', 'files/join');
      body.append('_redirect', '/');
      body.append('email', 'name@example.test');
      body.append('avatar', avatar());
      const res = await fetch(at, { method: 'POST', body, redirect: 'manual' });
      assert.equal(res.status, 303);
      assert.equal(calls[0].fields.avatar.name, 'avatar.svg');
      const big = new FormData();
      big.append('_action', 'files/signup');
      big.append('avatar', new File(['x'.repeat(64 * 1024)], 'big.bin'));
      const page = await fetch(at, { method: 'POST', body: big });
      assert.equal(page.status, 413);
      assert.match(page.headers.get('content-type'), /text\/html/, 'a form post reads a page');
      assert.match(await page.text(), /413/);
      const call = await fetch(at, { method: 'POST', headers: { 'content-type': 'application/json', 'x-what-action': 'files/signup' }, body: JSON.stringify({ args: ['x'.repeat(64 * 1024)] }) });
      assert.equal(call.status, 413);
      assert.deepEqual(await call.json(), { message: 'Payload too large' });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('fetchActionHandler takes the action client\'s multipart call', async () => {
    calls.length = 0;
    const handle = fetchActionHandler({ skipCsrf: true });
    const body = new FormData();
    body.append('_state', JSON.stringify({ step: 1 }));
    body.append('email', 'typo');
    body.append('avatar', avatar());
    const res = await handle(new Request(`${origin}/__what_action`, { method: 'POST', headers: { 'x-what-action': 'files/signup' }, body }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).upload.name, 'avatar.svg');
    assert.deepEqual(calls[0].previous, { step: 1 });
  });
});

describe('a body over bodyLimit', () => {
  const page = { mode: 'server', stream: false };
  const formPost = () => new URLSearchParams({ _action: 'files/signup', pad: 'x'.repeat(2048) }).toString();
  const cases = [
    ['a form posted to the action endpoint', '/__what_action', { 'content-type': 'application/x-www-form-urlencoded' }, formPost, 'html'],
    ['a form posted to a page', '/', { 'content-type': 'application/x-www-form-urlencoded', accept: '*/*' }, formPost, 'html'],
    ['an action call', '/__what_action', { 'content-type': 'application/json', 'x-what-action': 'files/signup', accept: 'text/html' }, () => JSON.stringify({ args: ['x'.repeat(2048)] }), 'json'],
    ['a fetch of JSON that accepts HTML', '/__what_revalidate', { 'content-type': 'application/json', accept: 'text/html' }, () => JSON.stringify({ pad: 'x'.repeat(2048) }), 'html'],
    ['a fetch of JSON', '/__what_revalidate', { 'content-type': 'application/json' }, () => JSON.stringify({ pad: 'x'.repeat(2048) }), 'json'],
  ];
  it('is answered 413 by one rule on every entry point: a page for a browser\'s form post, JSON for an action call', async () => {
    const handle = handlerFor(SignupPage, page, { bodyLimit: 1024, revalidateWebhook: async () => ({ status: 200, body: {} }) });
    const server = http.createServer(toNodeListener(handle));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const node = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const [what, path, headers, body, type] of cases) {
        for (const [entry, send] of [
          ['createRequestHandler', () => handle(new Request(origin + path, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', ...headers }, body: body() }))],
          ['the Node adapter', () => fetch(node + path, { method: 'POST', headers, body: body() })],
        ]) {
          const res = await send();
          assert.equal(res.status, 413, `${what}, ${entry}`);
          assert.match(res.headers.get('content-type'), type === 'html' ? /text\/html/ : /application\/json/, `${what}, ${entry}`);
        }
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('toNodeListener takes the limit of a handler wrapped in a function of yours', async () => {
    const handle = handlerFor(SignupPage, page, { bodyLimit: 3 * 1024 * 1024 });
    const wrapped = async (request) => {
      const res = await handle(request);
      res.headers.set('x-wrapped', '1');
      return res;
    };
    const body = new URLSearchParams({ other: 'x'.repeat(2 * 1024 * 1024) }).toString();
    for (const [listener, status] of [[toNodeListener(wrapped), 413], [toNodeListener(wrapped, { bodyLimit: 3 * 1024 * 1024 }), 200]]) {
      const server = http.createServer(listener);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
        assert.equal(res.status, status);
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    }
    assert.throws(() => toNodeListener(wrapped, { bodyLimit: 0 }), TypeError);
  });
});

describe('compiled JSX', () => {
  it('a compiled form with a file, posted without JavaScript, renders the state the action returned', async () => {
    globalThis.__filesSignup = signup;
    const { Signup } = await loadCompiled(`
      import { useActionState } from 'what-framework';
      import { Form } from ${JSON.stringify(import.meta.resolve('../src/index.js'))};
      export function Signup() {
        const [state, save] = useActionState(globalThis.__filesSignup, null);
        return <main><Form action={save} enctype="multipart/form-data">
          <input name="email" defaultValue={state()?.fields?.email ?? ''} />
          <input type="file" name="avatar" />
          {state()?.error ? <p role="alert">{state().error}</p> : null}
          {state()?.upload ? <output>{state().upload.name}</output> : null}
        </Form></main>;
      }`, { pluginOptions: { generate: 'ssr' } });
    for (const page of [{ mode: 'server' }, { mode: 'server', stream: false }]) {
      calls.length = 0;
      const res = await postPage(handlerFor(Signup, page), [['email', 'typo'], ['avatar', avatar()]]);
      const html = await res.text();
      assert.match(html, /role="alert">(<!--\$-->)?Enter a valid email/);
      assert.match(html, /<output>(<!--\$-->)?avatar\.svg/);
      assert.ok(calls[0].fields.avatar instanceof File);
    }
  });
});
