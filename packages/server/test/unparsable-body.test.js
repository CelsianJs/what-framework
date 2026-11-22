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
