// A redirect loop the router stops is a coded diagnostic, ERR_REDIRECT_CYCLE,
// carrying the URLs it went through and the routes whose guards redirected,
// so what_errors and captureDiagnostics see it (round 5, agent session F2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/login' });
const { h, mount, signal } = await import('what-core');
const { captureDiagnostics } = await import('what-core/testing');
const { Router } = await import('../src/index.js');

test('two guards that send each other round are reported with the cycle and the guards', async () => {
  const user = signal({ admin: false });
  let stop = () => {};
  const { events } = await captureDiagnostics(async () => {
    stop = mount(h(Router, { routes: [
      { path: '/login', component: () => h('p', {}, 'login'), middleware: [() => !user() || '/dashboard'] },
      { path: '/dashboard', component: () => h('p', {}, 'dash'), middleware: [() => user().admin || '/login'] },
    ] }), document.getElementById('app'));
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  stop();
  const loop = events.find((e) => e.code === 'ERR_REDIRECT_CYCLE');
  assert.ok(loop, JSON.stringify(events.map((e) => e.code)));
  assert.match(loop.data.cycle, /\/login → \/dashboard → \/login/);
  assert.match(loop.data.guards, /\/login/);
  assert.match(loop.data.guards, /\/dashboard/);
  assert.match(loop.message, /Redirect loop \(a cycle\)/);
});

// The cycle and the guards are paths and route patterns: the query and the
// fragment the visitor arrived with (a token, an email) stay out of what the
// dev channel and production's console.error carry.
test('the report carries paths and route patterns, never the query or fragment', async () => {
  history.replaceState(null, '', '/login?token=SECRET-TOKEN&email=ann%40example.test#frag-SECRET');
  const user = signal({ admin: false });
  let stop = () => {};
  const { events } = await captureDiagnostics(async () => {
    stop = mount(h(Router, { routes: [
      { path: '/login', component: () => h('p', {}, 'login'), middleware: [() => !user() || '/team/7?from=SECRET-NEXT'] },
      { path: '/team/:id', component: () => h('p', {}, 'team'), middleware: [() => user().admin || '/login?again=SECRET-AGAIN'] },
    ] }), document.getElementById('app'));
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  stop();
  const loop = events.find((e) => e.code === 'ERR_REDIRECT_CYCLE');
  assert.ok(loop, JSON.stringify(events.map((e) => e.code)));
  assert.match(loop.data.cycle, /^\/login → \/team\/:id → \/login/);
  assert.deepEqual(loop.data.guards.split(', ').sort(), ['/login', '/team/:id']);
  assert.doesNotMatch(JSON.stringify(loop), /SECRET|ann%40|example\.test|frag-|\/team\/7/);
});

// A path carries data too (a token segment): the cycle is the route patterns
// it went through, in development and in production's console.error alike.
const tokenRoutes = `[
  { path: '/verify/:token', component: () => h('p', {}, 'verify'), middleware: [() => '/login'] },
  { path: '/login', component: () => h('p', {}, 'login'), middleware: [() => '/gone/SECRET-GONE'] },
  { path: '*', component: () => h('p', {}, 'none'), middleware: [() => '/verify/SECRET-AGAIN'] },
]`;

test('a path segment the visitor sent stays out of the report, in development', async () => {
  history.replaceState(null, '', '/verify/SECRET-PATH-TOKEN');
  let stop = () => {};
  const { events } = await captureDiagnostics(async () => {
    // eslint-disable-next-line no-new-func
    const routes = new Function('h', `return ${tokenRoutes}`)(h);
    stop = mount(h(Router, { routes }), document.getElementById('app'));
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  stop();
  const loop = events.find((e) => e.code === 'ERR_REDIRECT_CYCLE');
  assert.ok(loop, JSON.stringify(events.map((e) => e.code)));
  assert.match(loop.data.cycle, /\/verify\/:token → \/login → \*/);
  assert.doesNotMatch(JSON.stringify(loop), /SECRET/);
});

test('and in production', async () => {
  const { execFileSync } = await import('node:child_process');
  const script = `
    globalThis.__WHAT_DEV__ = false;
    const { installDOM } = await import(${JSON.stringify(new URL('../../../test-utils/dom.js', import.meta.url).href)});
    installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/verify/SECRET-PATH-TOKEN' });
    const lines = [];
    console.error = (...args) => lines.push(args.join(' '));
    const { h, mount } = await import('what-core');
    const { Router } = await import(${JSON.stringify(new URL('../src/index.js', import.meta.url).href)});
    const routes = ${tokenRoutes};
    mount(h(Router, { routes }), document.getElementById('app'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    process.stdout.write(JSON.stringify(lines));
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: new URL('.', import.meta.url), encoding: 'utf8' }));
  const loop = out.find((line) => line.includes('Redirect loop'));
  assert.ok(loop, JSON.stringify(out));
  assert.match(loop, /\/verify\/:token → \/login → \*/);
  assert.doesNotMatch(loop, /SECRET/);
});
