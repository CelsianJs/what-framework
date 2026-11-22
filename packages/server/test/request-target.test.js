// A request target is untrusted text. The Node entry points take a path only
// and never let parsing it throw out of a request: nodeActionMiddleware
// compares the raw path with its endpoint before anything parses it, never
// rejects (connect and Express 4 drop the promise a middleware returns, and
// Node ends the process on a rejection nobody handles), and builds the
// action's Request from the connection (its TLS socket, its Host header) and
// that path, never from an authority in the target. The CSRF origin check
// takes the scheme from the same place. toNodeListener and whatMiddleware
// answer 400 for a target that is not a path.

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
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';
    const lines = [`${method} ${target} HTTP/1.1`, 'host: victim.test', 'connection: close',
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), `content-length: ${Buffer.byteLength(body)}`, '', body];
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
