// A request body that does not parse as its content type says never runs an
// action, on any entry point: a 400, JSON for an action call and a page for a
// form posted to a page. Before, a multipart call with the wrong boundary, cut
// short, or with a value holding the boundary ran the action with `[{}]` and
// answered 200 on createRequestHandler (fetch and Node) and fetchActionHandler:
// the parse failure was turned into `{}`, which is an empty form.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const S = await import('../src/node.js');

const runs = [];
S.action(async (...args) => { runs.push(args); return { saved: true }; }, { id: 'unparsable/save' });
const core = S.createRequestHandler({
  routes: [{ path: '/p', component: () => null, page: { mode: 'server' } }],
  csrf: false,
});
const fetchHandler = S.fetchActionHandler({ skipCsrf: true });
const middleware = S.nodeActionMiddleware({ skipCsrf: true });

const servers = [];
async function listen(listener) {
  const server = http.createServer(listener);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return server.address().port;
}
after(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

const B = 'unparsable-boundary';
const good = `--${B}\r\nContent-Disposition: form-data; name="title"\r\n\r\nHello\r\n--${B}--\r\n`;
const BODIES = [
  ['a multipart body with another boundary', 'multipart/form-data; boundary=other', good],
  ['a multipart body cut short', `multipart/form-data; boundary=${B}`, good.slice(0, 40)],
  ['a multipart body whose value holds the boundary', `multipart/form-data; boundary=${B}`, `--${B}\r\nContent-Disposition: form-data; name="title"\r\n\r\nsee ${B}\r\n--${B}--\r\n`],
  ['a multipart type with no boundary', 'multipart/form-data', good],
  ['JSON that does not parse', 'application/json', '{"args":[{"title":'],
];

function viaSocket(port, path, headers, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers: { ...headers, 'content-length': Buffer.byteLength(body) } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], text }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

describe('a body that does not parse', () => {
  it('runs no action, and answers 400 JSON, on every entry point of an action call', async () => {
    const nodePort = await listen(S.toNodeListener(core));
    const middlewarePort = await listen((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
    for (const [label, type, body] of BODIES) {
      const headers = { 'content-type': type, 'x-what-action': 'unparsable/save', 'sec-fetch-site': 'same-origin' };
      const request = () => new Request('http://app.test/__what_action', { method: 'POST', headers, body });
      const answers = {
        'createRequestHandler': await core(request()).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), text: await r.text() })),
        'the Node adapter': await viaSocket(nodePort, '/__what_action', headers, body),
        fetchActionHandler: await fetchHandler(request()).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), text: await r.text() })),
        nodeActionMiddleware: await viaSocket(middlewarePort, '/__what_action', headers, body),
      };
      for (const [entry, answer] of Object.entries(answers)) {
        assert.equal(answer.status, 400, `${label}, ${entry}`);
        assert.match(answer.type, /application\/json/, `${label}, ${entry}`);
      }
      assert.deepEqual(runs, [], label);
    }
  });

  it('posted as a form to the action endpoint, answers a 400 page and runs nothing', async () => {
    const nodePort = await listen(S.toNodeListener(core));
    for (const [label, type, body] of BODIES.filter(([, type]) => type.startsWith('multipart'))) {
      const headers = { 'content-type': type, 'sec-fetch-site': 'same-origin' };
      const fetched = await core(new Request('http://app.test/__what_action', { method: 'POST', headers, body }));
      assert.equal(fetched.status, 400, label);
      assert.match(fetched.headers.get('content-type'), /text\/html/, label);
      const viaNode = await viaSocket(nodePort, '/__what_action', headers, body);
      assert.equal(viaNode.status, 400, label);
      assert.deepEqual(runs, [], label);
    }
  });

  // A POST to a page whose body does not parse names no action: the page
  // renders it as its own, as before.
  it('posted to a page, runs no action and reaches the page', async () => {
    for (const [label, type, body] of BODIES.filter(([, type]) => type.startsWith('multipart'))) {
      const fetched = await core(new Request('http://app.test/p', { method: 'POST', headers: { 'content-type': type, 'sec-fetch-site': 'same-origin' }, body }));
      assert.equal(fetched.status, 200, label);
      assert.deepEqual(runs, [], label);
    }
  });

  it('a body that parses still runs its action', async () => {
    const answer = await core(new Request('http://app.test/__what_action', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${B}`, 'x-what-action': 'unparsable/save', 'sec-fetch-site': 'same-origin' },
      body: good,
    }));
    assert.equal(answer.status, 200);
    assert.equal(runs.length, 1);
  });
});

// A body whose stream fails while it is read (a client that goes away
// mid-upload) is one that does not parse, on every reader: no action runs
// with `{}`, which is an empty form. Before, a no-JS form post naming its
// action in the query ran it with `{}` through a reader that turned the
// failure into an empty body.
describe('a body whose stream fails while it is read', () => {
  const failing = (text) => new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(text)); },
    pull(c) { c.error(new Error('connection reset')); },
  });
  const post = (path, headers, text) => new Request(`http://app.test${path}`, { method: 'POST', headers, body: failing(text), duplex: 'half' });

  it('runs no action and answers 400 on the fetch entry points', async () => {
    runs.length = 0;
    const formHandler = S.createFormPostHandler({ csrf: false });
    for (const type of ['application/json', 'application/x-www-form-urlencoded', `multipart/form-data; boundary=${B}`]) {
      const call = { 'content-type': type, 'x-what-action': 'unparsable/save', 'sec-fetch-site': 'same-origin' };
      assert.equal((await core(post('/__what_action', call, '{"args":[{"title":"hel'))).status, 400, `createRequestHandler, ${type}`);
      assert.equal((await fetchHandler(post('/__what_action', call, 'title=hel'))).status, 400, `fetchActionHandler, ${type}`);
    }
    const form = { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' };
    const viaQuery = await core(post('/__what_action?action=unparsable/save', form, 'title=hel'));
    assert.equal(viaQuery.status, 400, 'a no-JS form post naming its action in the query');
    assert.match(viaQuery.headers.get('content-type'), /text\/html/);
    assert.equal((await fetchHandler(post('/__what_action?action=unparsable/save', form, 'title=hel'))).status, 400);
    assert.equal(await formHandler({ method: 'POST', headers: form, request: post('/p', form, '_action=unparsable/save&title=hel') }), null, 'createFormPostHandler names no action');
    assert.equal((await core(post('/p', form, '_action=unparsable/save&title=hel'))).status, 200, 'a page POST reaches the page');
    assert.deepEqual(runs, []);
  });

  it('runs no action and answers 400 on the Node middleware', async () => {
    runs.length = 0;
    const { Readable } = await import('node:stream');
    for (const headers of [
      { 'content-type': 'application/json', 'x-what-action': 'unparsable/save', 'sec-fetch-site': 'same-origin', host: 'app.test' },
      { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', host: 'app.test' },
    ]) {
      const req = new Readable({ read() { this.push('title=hel'); this.destroy(new Error('connection reset')); } });
      Object.assign(req, { method: 'POST', url: '/__what_action?action=unparsable/save', headers, socket: {} });
      const answer = await new Promise((resolve) => {
        const res = { headersSent: false, writeHead(status) { this.status = status; }, end() { resolve(this.status); }, destroy() { resolve('destroyed'); } };
        middleware(req, res, () => resolve('next'));
      });
      assert.equal(answer, 400, headers['content-type']);
    }
    assert.deepEqual(runs, []);
  });
});

// The action endpoint's query is read by the framework's linear parser
// (fields.js), as its bodies are: a fetch handler sees the whole URL, which
// no header limit bounds, and Node 24's URLSearchParams is quadratic in
// pairs with no `=`.
describe("the action endpoint's query", () => {
  it('is parsed in time linear in its length', async () => {
    const query = 'a&'.repeat(512 * 1024);
    for (const [label, handle] of [['fetchActionHandler', fetchHandler], ['createRequestHandler', core]]) {
      const started = performance.now();
      const answer = await handle(new Request(`http://app.test/__what_action?${query}`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{}' }));
      const elapsed = performance.now() - started;
      assert.equal(answer.status, 400, label);
      assert.ok(elapsed < 1000, `${label} took ${Math.round(elapsed)} ms`);
    }
  });
});
