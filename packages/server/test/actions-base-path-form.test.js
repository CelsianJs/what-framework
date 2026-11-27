// Server actions of an app served below a base path ('/app'), without
// JavaScript. A <Form> of a server action posts to the action endpoint below
// the base, and its `redirect` (or a useActionState permalink) is a URL of the
// app, written below the base, as what-router writes one. The request
// handler's `basePath` serves that endpoint, and the 303 a post is answered
// with goes below the base: to a redirect the action made, as it does with
// JavaScript, where the router navigates to it, or to the app's root when the
// form names no page. Before, the form posted to '/__what_action' at the root,
// which a proxy that forwards only '/app/*' never passes on, and the action's
// redirect left the base.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { h, getResponse, useActionState } from 'what-core';
import { setBase } from 'what-router';
import { Form, action, createRequestHandler, renderToString } from '../src/index.js';

const origin = 'http://app.test';
const done = [];
const subscribe = action(async (fields) => {
  done.push(fields.email);
  return { ok: true };
}, { id: 'base/subscribe' });
action(async () => {
  getResponse().redirect('/thanks?from=form');
  return { ok: true };
}, { id: 'base/thanks' });
const publish = action(async (_previous, fields) => {
  getResponse().redirect('/posts/' + encodeURIComponent(fields.slug));
  return { saved: true };
}, { id: 'base/publish' });

before(() => setBase('/app/'));
after(() => setBase(''));

function post(handle, path, body, headers = {}) {
  return handle(new Request(origin + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', ...headers },
    body: new URLSearchParams(body).toString(),
  }));
}

describe('a server action\'s form below a base path, without JavaScript', () => {
  it('posts to the action endpoint below the base, and its redirect is below it', async () => {
    const html = await renderToString(h(Form, { action: subscribe, redirect: '/done' }, h('input', { name: 'email' })));
    assert.match(html, /<form[^>]*action="\/app\/__what_action"/);
    assert.match(html, /name="_redirect" value="\/app\/done"/);
    function Permalinked() {
      const [, dispatch] = useActionState(publish, null, '/posts/one/edit');
      return h(Form, { action: dispatch }, h('button', {}, 'Save'));
    }
    assert.match(await renderToString(h(Permalinked, {})), /<form[^>]*action="\/app\/posts\/one\/edit"/);
  });

  it('is answered below the base by a request handler with that basePath', async () => {
    const handle = createRequestHandler({ routes: [], basePath: '/app' });

    const plain = await post(handle, '/app/__what_action', { _action: 'base/subscribe', _redirect: '/app/done', email: 'a@b.c' });
    assert.equal(plain.status, 303);
    assert.equal(plain.headers.get('location'), '/app/done');
    assert.deepEqual(done, ['a@b.c']);

    const redirected = await post(handle, '/app/__what_action', { _action: 'base/thanks', _redirect: '/app/done' });
    assert.equal(redirected.status, 303);
    assert.equal(redirected.headers.get('location'), '/app/thanks?from=form', 'the action\'s redirect is a URL of the app');

    const nowhere = await post(handle, '/app/__what_action', { _action: 'base/subscribe', email: 'd@e.f' });
    assert.equal(nowhere.headers.get('location'), '/app/', 'no page named: the app\'s root');
  });

  it('answers a form posted to its page with the action\'s redirect below the base', async () => {
    const routes = [{ path: '/posts/:slug/edit', component: () => h('main', null, 'edit'), mode: 'server' }];
    const handle = createRequestHandler({ routes, basePath: '/app' });
    const res = await post(handle, '/app/posts/one/edit', { _action: 'base/publish', _state: 'null', slug: 'one' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/app/posts/one');
  });
});
