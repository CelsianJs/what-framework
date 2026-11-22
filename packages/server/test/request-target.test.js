// A request target is untrusted text. The Node entry points take a path only
// and never let parsing it throw out of a request: nodeActionMiddleware
// compares the raw path with its endpoint before anything parses it, never
// rejects (connect and Express 4 drop the promise a middleware returns, and
// Node ends the process on a rejection nobody handles), and builds the
// action's Request from the connection (its TLS socket, its Host header) and
// that path, never from an authority in the target. The CSRF origin check
// takes the scheme from the same place. toNodeListener and whatMiddleware
// answer 400 for a target that is not a path, and for a Host header that is
// not a host (request-url.js): `Host: h/admin?` must not make What render
// /admin for `GET /public` (round 5, V1), and userinfo is a 400, not a 500
// with a logged stack (V4).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { action } from '../src/actions.js';
import { nodeActionMiddleware } from '../src/action-handler.js';
import { getRequest } from '../src/index.js';
import { toNodeListener, whatMiddleware } from '../src/adapter/node.js';
import { h } from 'what-core';

let seenUrl = null;
action(() => {
  seenUrl = getRequest().url;
  return 'ok';
}, { id: 'targetWhoCalls' });

const HOSTILE = ['//', '//[::1', '/\\', '//@', '//evil.test/__what_action', '/static/../__what_action',
  '/x/%2e%2e/__what_action', 'http://evil.test/__what_action', 'http://[', '*'];

// One raw HTTP/1.1 request, written as is: no client library normalizes it.
function raw(port, method, target, headers = {}, body = '') {
  const { host = 'victim.test', ...rest } = headers;
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';
    const lines = [`${method} ${target} HTTP/1.1`, `host: ${host}`, 'connection: close',
      ...Object.entries(rest).map(([k, v]) => `${k}: ${v}`), `content-length: ${Buffer.byteLength(body)}`, '', body];
    // Without an answer the request would wait forever: a status of 0 says so.
    socket.setTimeout(3000, () => socket.destroy());
    socket.on('connect', () => socket.write(lines.join('\r\n')));
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('error', () => resolve({ status: 0, body: '' }));
    socket.on('close', () => {
      const status = Number((/^HTTP\/1\.1 (\d+)/.exec(data) || [])[1] || 0);
      resolve({ status, body: data.slice(data.indexOf('\r\n\r\n') + 4) });
    });
  });
}

// The dispatch rule of connect and Express 4: a synchronous throw goes to the
// error handler, a returned promise is dropped.
function connectStyle(...stack) {
  return (req, res) => {
    let i = 0;
    const next = (err) => {
      const layer = stack[i++];
      if (err || !layer) {
        res.writeHead(err ? 500 : 404);
        res.end(err ? 'error handler' : 'not found');
        return;
      }
      try {
        layer(req, res, next);
      } catch (thrown) {
        next(thrown);
      }
    };
    next();
  };
}

const notAction = (req, res) => {
  res.writeHead(404);
  res.end('next(): not an action');
};

describe('nodeActionMiddleware takes the raw path and never rejects', () => {
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  /** @type {http.Server[]} */
  const servers = [];
  const ports = {};

  before(async () => {
    process.on('unhandledRejection', onRejection);
    const mw = nodeActionMiddleware({ skipCsrf: true });
    const stacks = {
      'node:http': (req, res) => mw(req, res, () => notAction(req, res)),
      'connect-style chain': connectStyle(mw, notAction),
    };
    for (const [name, listener] of Object.entries(stacks)) {
      const server = http.createServer(listener);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      ports[name] = /** @type {any} */ (server.address()).port;
    }
  });

  after(() => {
    process.off('unhandledRejection', onRejection);
    for (const server of servers) server.close();
  });

  for (const stack of ['node:http', 'connect-style chain']) {
    it(`on ${stack}, every target that is not exactly the endpoint goes to next(), and the server keeps serving`, async () => {
      for (const target of HOSTILE) {
        for (const method of ['GET', 'POST']) {
          const answer = await raw(ports[stack], method, target, { 'x-what-action': 'targetWhoCalls' });
          assert.ok(answer.status === 404 || answer.status === 400, `${method} ${target}: ${answer.status} ${answer.body}`);
          if (answer.status === 404) assert.match(answer.body, /next\(\): not an action/, `${method} ${target}`);
        }
      }
      const served = await raw(ports[stack], 'POST', '/__what_action?x=1', { 'x-what-action': 'targetWhoCalls', 'content-type': 'application/json' }, '{"args":[]}');
      assert.equal(served.status, 200);
      assert.equal(seenUrl, 'http://victim.test/__what_action?x=1', 'the action sees the Host header and the path');
      assert.deepEqual(rejections, []);
    });
  }
});

function mockReq(url, headers, encrypted) {
  const req = new EventEmitter();
  Object.assign(req, { method: 'POST', url, headers: { host: 'app.test', 'x-what-action': 'targetWhoCalls', ...headers }, socket: { encrypted } });
  queueMicrotask(() => {
    req.emit('data', Buffer.from(JSON.stringify({ args: [] })));
    req.emit('end');
  });
  return req;
}

function mockRes() {
  return {
    statusCode: 0,
    headersSent: false,
    writeHead(status) { this.statusCode = status; this.headersSent = true; return this; },
    end() {},
  };
}

describe('nodeActionMiddleware judges an Origin by the scheme of its connection', () => {
  const verdict = async (origin, { encrypted = false, forwarded } = {}) => {
    const res = mockRes();
    const headers = forwarded ? { origin, 'x-forwarded-proto': forwarded } : { origin };
    await nodeActionMiddleware({ getCsrfToken: () => 'token' })(mockReq('/__what_action', headers, encrypted), res, () => {});
    return res.statusCode === 403 ? 'refused' : 'accepted';
  };

  it('a TLS socket is https: the page\'s own https origin is accepted, an http one refused', async () => {
    assert.equal(await verdict('https://app.test', { encrypted: true }), 'accepted');
    assert.equal(await verdict('http://app.test', { encrypted: true }), 'refused');
  });

  it('a plain socket is http, unless the proxy in front says https', async () => {
    assert.equal(await verdict('http://app.test'), 'accepted');
    assert.equal(await verdict('https://app.test'), 'refused');
    assert.equal(await verdict('https://app.test', { forwarded: 'https' }), 'accepted');
    assert.equal(await verdict('http://app.test', { forwarded: 'https' }), 'refused');
  });

  it('the action\'s Request is https on a TLS socket', async () => {
    seenUrl = null;
    await nodeActionMiddleware({ skipCsrf: true })(mockReq('/__what_action', {}, true), mockRes(), () => {});
    assert.equal(seenUrl, 'https://app.test/__what_action');
  });
});

describe('the Node adapter takes a path only', () => {
  /** @type {http.Server[]} */
  const servers = [];
  const ports = {};
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);

  before(async () => {
    process.on('unhandledRejection', onRejection);
    const options = { routes: [{ path: '/', component: () => h('p', null, 'home'), page: { mode: 'server', stream: false } }] };
    const stacks = {
      toNodeListener: (await import('../src/adapter/core.js')).createRequestHandler(options),
      whatMiddleware: whatMiddleware(options),
    };
    for (const [name, handler] of Object.entries(stacks)) {
      const listener = name === 'toNodeListener' ? toNodeListener(handler) : connectStyle(handler, notAction);
      const server = http.createServer(listener);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      ports[name] = /** @type {any} */ (server.address()).port;
    }
  });

  after(() => {
    process.off('unhandledRejection', onRejection);
    for (const server of servers) server.close();
  });

  for (const stack of ['toNodeListener', 'whatMiddleware']) {
    it(`${stack}: an absolute-form, authority-form or '*' target is 400, '//' is a path, and nothing rejects`, async () => {
      for (const target of ['http://evil.test/', 'http://[', '*', 'evil.test:80']) {
        assert.equal((await raw(ports[stack], 'GET', target)).status, 400, target);
      }
      assert.equal((await raw(ports[stack], 'GET', '//')).status, 404, "'//' is the path '//', which no route matches");
      const home = await raw(ports[stack], 'GET', '/');
      assert.equal(home.status, 200);
      assert.match(home.body, /home/);
      assert.deepEqual(rejections, []);
    });
  }
});

describe('a Host header names a host, never the path', () => {
  /** @type {http.Server[]} */
  const servers = [];
  const ports = {};
  const logged = [];
  const error = console.error;

  before(async () => {
    console.error = (...args) => logged.push(args.join(' '));
    const page = (text) => () => h('p', null, text);
    const options = { routes: [
      { path: '/public', component: page('public page'), page: { mode: 'server', stream: false } },
      { path: '/admin', component: page('admin page'), page: { mode: 'server', stream: false } },
    ] };
    const stacks = {
      toNodeListener: toNodeListener((await import('../src/adapter/core.js')).createRequestHandler(options)),
      whatMiddleware: connectStyle(whatMiddleware(options), notAction),
      nodeActionMiddleware: connectStyle(nodeActionMiddleware(), notAction),
    };
    for (const [name, listener] of Object.entries(stacks)) {
      const server = http.createServer(listener);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      ports[name] = /** @type {any} */ (server.address()).port;
    }
  });

  after(() => {
    console.error = error;
    for (const server of servers) server.close();
  });

  const NOT_HOSTS = ['h/admin?', 'h/admin#', 'h\\admin?', 'h\\admin#', 'a@evil.test', 'user:pw@app.test', 'app.test:99999', 'app.test:abc', '%', '['];
  const HOSTS = ['app.test', 'app.test:8080', '127.0.0.1:3000', '[::1]:3000', 'my_app', 'app.test.'];

  for (const stack of ['toNodeListener', 'whatMiddleware']) {
    it(`${stack}: a Host that is not a host is 400 and renders nothing; a host renders the target's path`, async () => {
      for (const host of NOT_HOSTS) {
        const res = await raw(ports[stack], 'GET', '/public', { host });
        assert.equal(res.status, 400, host);
        assert.doesNotMatch(res.body, /admin page|public page/, host);
      }
      for (const host of HOSTS) {
        const res = await raw(ports[stack], 'GET', '/public', { host });
        assert.equal(res.status, 200, host);
        assert.match(res.body, /public page/, host);
      }
      assert.deepEqual(logged, [], 'nothing is logged');
    });
  }

  it('nodeActionMiddleware: a Host that is not a host is 400', async () => {
    for (const host of NOT_HOSTS) {
      const res = await raw(ports.nodeActionMiddleware, 'POST', '/__what_action', { host, 'content-type': 'application/json', 'x-what-action': 'targetWhoCalls', 'sec-fetch-site': 'same-origin' }, '{"args":[]}');
      assert.equal(res.status, 400, host);
    }
    seenUrl = null;
    const res = await raw(ports.nodeActionMiddleware, 'POST', '/__what_action', { host: 'app.test:8080', 'content-type': 'application/json', 'x-what-action': 'targetWhoCalls', 'sec-fetch-site': 'same-origin' }, '{"args":[]}');
    assert.equal(res.status, 200);
    assert.equal(seenUrl, 'http://app.test:8080/__what_action');
  });
});

// The path What routes is the target's own, as a server in front of it saw
// it. URL parsing resolves dot segments (literal and percent-encoded) and
// reads a backslash as a slash, so `GET /public/../admin` would render /admin
// past an Express guard on /admin that routed /public, and
// `POST /x/../__what_action` would run an action past a guard on the
// endpoint (round 6, S3). Such a target is answered 400; browsers never send
// one. HTTP/2 names its host in `:authority`, a pseudo-header that is not a
// header field (P2).
describe('a target with a dot segment or a backslash is 400', () => {
  const DOTTED = ['/public/../admin', '/public/%2e%2e/admin', '/public/.%2E/admin', '/public/%2E%2e/admin', '/public/./admin',
    '/x/%2e/admin', '/public\\..\\admin', '/public\\admin', '/..', '/x/..', '/public/..?q=1', '/x/../__what_action', '/x/%2e%2e/__what_action'];
  const PLAIN = ['/public', '/a.b', '/..a', '/a..', '/a/...', '/.well-known/x', '/public?next=/../admin'];
  /** @type {http.Server[]} */
  const servers = [];
  const ports = {};
  let ran = 0;

  before(async () => {
    action(() => { ran++; return 'ok'; }, { id: 'targetDotted' });
    const Page = () => h('p', null, 'public page');
    const options = { routes: [{ path: '/public', component: Page, page: { mode: 'server', stream: false } }, { path: '/admin', component: () => h('p', null, 'ADMIN'), page: { mode: 'server', stream: false } }] };
    const handler = (await import('../src/adapter/core.js')).createRequestHandler(options);
    for (const [name, listener] of [['toNodeListener', toNodeListener(handler)], ['whatMiddleware', connectStyle(whatMiddleware(options), notAction)]]) {
      const server = http.createServer(listener);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      ports[name] = /** @type {any} */ (server.address()).port;
    }
  });

  after(() => {
    for (const server of servers) server.close();
  });

  for (const stack of ['toNodeListener', 'whatMiddleware']) {
    it(`${stack}: never renders or acts on a path the target does not name`, async () => {
      for (const target of DOTTED) {
        const res = await raw(ports[stack], 'GET', target);
        assert.equal(res.status, 400, target);
        assert.doesNotMatch(res.body, /ADMIN/, target);
      }
      for (const target of ['/x/../__what_action', '/x/%2e%2e/__what_action', '/x\\..\\__what_action']) {
        const res = await raw(ports[stack], 'POST', target, { 'content-type': 'application/json', 'x-what-action': 'targetDotted', 'sec-fetch-site': 'same-origin' }, '{"args":[]}');
        assert.equal(res.status === 400 || res.status === 404, true, `${target}: ${res.status}`);
      }
      assert.equal(ran, 0, 'the action never ran');
      for (const target of PLAIN) {
        const res = await raw(ports[stack], 'GET', target);
        assert.notEqual(res.status, 400, target);
      }
    });
  }

  it('toNodeListener serves HTTP/2, its host from :authority when it sends no Host', async () => {
    const http2 = await import('node:http2');
    const handler = (await import('../src/adapter/core.js')).createRequestHandler({ routes: [{ path: '/who', component: () => h('p', null, 'who'), page: { mode: 'server', stream: false }, loader: () => ({}) }] });
    const server = http2.createServer(toNodeListener(handler));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = /** @type {any} */ (server.address());
    try {
      const get = (headers) => new Promise((resolve, reject) => {
        const client = http2.connect(`http://127.0.0.1:${port}`);
        client.on('error', reject);
        const req = client.request({ ':path': '/who', ...headers });
        let body = '';
        let status = 0;
        req.on('response', (h) => { status = h[':status']; });
        req.on('data', (d) => { body += d; });
        req.on('end', () => { client.close(); resolve({ status, body }); });
        req.on('error', reject);
        req.end();
      });
      const ok = await get({ ':authority': 'app.test' });
      assert.equal(ok.status, 200);
      assert.match(ok.body, /who/);
    } finally {
      server.close();
    }
  });
});
