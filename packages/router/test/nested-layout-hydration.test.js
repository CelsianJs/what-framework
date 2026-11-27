// A chain of route layouts renders on the server and hydrates clean: the
// client adopts the server's elements for every layout and the page, and a
// navigation afterwards keeps the layouts the two chains share (the very
// elements the server sent) and builds only the levels that differ.
//
// Its own file: the router keeps module-scoped URL state, and this one starts
// at /org/team/alpha.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let core;
let internal;
let server;
let router;
before(async () => {
  env = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://app.test/org/team/alpha?tab=1' });
  core = await import('what-core');
  internal = await import('what-core/internal');
  server = await import('../../server/src/index.js');
  router = await import('../src/index.js');
});
after(() => env.cleanup());

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function collect(stream) {
  let html = '';
  for await (const chunk of stream) html += chunk;
  return html;
}

function app(built) {
  const { h, signal } = core;
  const layout = (name) => {
    const Layout = (props) => {
      built.push(name);
      const clicks = signal(0);
      return h('div', { 'data-layout': name },
        h('button', { 'data-bump': name, onClick: () => clicks((c) => c + 1) }, () => `${name} ${clicks()} ${props.query.tab ?? '-'}`),
        props.children);
    };
    Object.defineProperty(Layout, 'name', { value: name });
    return Layout;
  };
  const [Org, Team, Alpha, Beta] = ['Org', 'Team', 'Alpha', 'Beta'].map(layout);
  const routes = [
    { path: '/org/_layout', layout: Org, component: () => null },
    { path: '/org/team/_layout', layout: Team, component: () => null },
    { path: '/org/team/alpha', layout: Alpha, component: () => h('p', { id: 'page' }, 'alpha') },
    { path: '/org/team/beta', layout: Beta, component: () => h('p', { id: 'page' }, 'beta') },
  ];
  const Shell = (props) => h('main', { id: 'shell' }, props.children);
  return () => h(router.Router, { routes, globalLayout: Shell });
}

describe('nested route layouts, server-rendered and hydrated', () => {
  it('hydrate clean, adopt the server\'s layouts, and keep the shared ones on the next navigation', async () => {
    const serverBuilt = [];
    const html = await collect(server.renderToStream(core.h(app(serverBuilt), {}), { request: new Request('http://app.test/org/team/alpha?tab=1') }));
    assert.deepEqual(serverBuilt, ['Org', 'Team', 'Alpha']);
    assert.match(html, /data-layout="Org"[\s\S]*data-layout="Team"[\s\S]*data-layout="Alpha"[\s\S]*alpha/);

    document.body.innerHTML = `<div id="app">${html}</div>`;
    internal.__resetHydrationData();
    const fromServer = {
      Org: document.querySelector('[data-layout="Org"]'),
      Team: document.querySelector('[data-layout="Team"]'),
      Alpha: document.querySelector('[data-layout="Alpha"]'),
      page: document.getElementById('page'),
    };
    const built = [];
    const mismatches = [];
    const stop = core.hydrate(core.h(app(built), {}), document.getElementById('app'), { onHydrationError: (info) => mismatches.push(info) });
    await tick();
    assert.deepEqual(mismatches, []);
    assert.deepEqual(built, ['Org', 'Team', 'Alpha']);
    assert.equal(document.querySelector('[data-layout="Org"]'), fromServer.Org, 'the outer layout is the server\'s element');
    assert.equal(document.querySelector('[data-layout="Team"]'), fromServer.Team);
    assert.equal(document.querySelector('[data-layout="Alpha"]'), fromServer.Alpha);
    assert.equal(document.getElementById('page'), fromServer.page);
    assert.equal(document.querySelectorAll('[data-layout]').length, 3, 'nothing was rendered twice');

    document.querySelector('[data-bump="Team"]').click();
    await tick();
    assert.equal(document.querySelector('[data-bump="Team"]').textContent, 'Team 1 1', 'the adopted layout is live');

    await router.navigate('/org/team/beta?tab=2');
    await tick();
    assert.deepEqual(built, ['Org', 'Team', 'Alpha', 'Beta']);
    assert.equal(document.querySelector('[data-layout="Org"]'), fromServer.Org, 'the shared layouts are still the server\'s elements');
    assert.equal(document.querySelector('[data-layout="Team"]'), fromServer.Team);
    assert.equal(document.querySelector('[data-layout="Alpha"]'), null);
    assert.equal(document.querySelector('[data-layout="Beta"] #page').textContent, 'beta');
    assert.equal(document.querySelector('[data-bump="Team"]').textContent, 'Team 1 2', 'kept with its state, and its query follows the URL');
    assert.equal(document.querySelector('[data-bump="Org"]').textContent, 'Org 0 2');
    stop();
  });
});
