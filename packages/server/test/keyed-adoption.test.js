// Keyless server values are adopted by key, never by position (functional
// review M1, security review #9).
//
// The client took "the next keyless value in owner-key order", with no check
// that the component asking was the one that produced it. A component that
// existed on one side only, or a second hydrate() root, shifted every later
// value onto a neighbour: Orders showed Profile's data, a client-only chat
// widget received the account's IBAN. The client now numbers its components
// the way the server numbered its frames, looks its own owner key up, and
// adopts a value only when the server's component at that owner path has the
// same name; anything else fetches.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let cleanup;
let core;
let internal;
let server;
let islands;
let collect;

before(async () => {
  ({ cleanup } = installDOM());
  core = await import('what-core');
  internal = await import('what-core/internal');
  server = await import('../src/index.js');
  islands = await import('../src/islands.js');
  ({ collect } = await import('./stream-helpers.js'));
});
after(() => cleanup());

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const bodyOf = (html) => html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));

// A component whose keyless resource yields `value`, logging where it fetched.
function resourceComponent(name, value, calls) {
  const component = {
    [name]() {
      const { h, createResource } = core;
      const { getServerContext } = internal;
      const [v] = createResource(() => {
        calls.push(`${name}@${getServerContext() ? 'server' : 'client'}`);
        return tick().then(() => value);
      });
      return h('p', { id: name.toLowerCase() }, () => `${name}=${v() ?? '(loading)'}`);
    },
  }[name];
  return component;
}

// What each rendered element says. Hydration claims elements by position and
// keeps a claimed element's own attributes, so after a component that exists
// on one side only, ids no longer name the component that renders into them;
// the text does.
function texts(root) {
  return [...root.querySelectorAll('p, aside')].map((el) => el.textContent);
}

function clientFetches(calls) {
  return calls.filter((call) => call.endsWith('@client'));
}

function quietly(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

describe('a page hydrated whole adopts every keyless value', () => {
  it('renderDocument into <body>: no fetch on the client', async () => {
    const calls = [];
    const { h, Suspense } = core;
    const Profile = resourceComponent('Profile', 'PROFILE OF ALICE', calls);
    const Orders = resourceComponent('Orders', 'ORDERS OF ALICE', calls);
    const App = () => h(Suspense, { fallback: 'fb' }, h('div', null, h(Profile, {}), h(Orders, {})));
    const html = await server.renderDocument({ default: App });
    document.body.innerHTML = bodyOf(html);
    internal.__resetHydrationData();
    calls.length = 0;
    core.hydrate(h(App, {}), document.body);
    await tick(20);
    assert.deepEqual(clientFetches(calls), []);
    assert.equal(document.getElementById('profile').textContent, 'Profile=PROFILE OF ALICE');
    assert.equal(document.getElementById('orders').textContent, 'Orders=ORDERS OF ALICE');
  });

  it('renderToStream inside a container: no fetch on the client', async () => {
    const calls = [];
    const { h, Suspense } = core;
    const Profile = resourceComponent('Profile', 'P', calls);
    const App = () => h(Suspense, { fallback: 'fb' }, h(Profile, {}));
    const html = await collect(server.renderToStream(h(App, {})));
    document.body.innerHTML = `<div id="app">${html}</div>`;
    internal.__resetHydrationData();
    calls.length = 0;
    core.hydrate(h(App, {}), document.getElementById('app'));
    await tick(20);
    assert.deepEqual(clientFetches(calls), []);
    assert.equal(document.getElementById('profile').textContent, 'Profile=P');
  });
});

describe('a component on one side only never hands its value to a neighbour', () => {
  it('a server-only component before the others (the review\'s banner)', async () => {
    const calls = [];
    const { h, Suspense } = core;
    const { getServerContext } = internal;
    const Banner = resourceComponent('Banner', 'SERVER-ONLY BANNER DATA', calls);
    const Profile = resourceComponent('Profile', 'PROFILE OF ALICE', calls);
    const Orders = resourceComponent('Orders', 'ORDERS OF ALICE', calls);
    const App = () => h(Suspense, { fallback: 'fb' },
      h('div', null, getServerContext() ? h(Banner, {}) : null, h(Profile, {}), h(Orders, {})));
    const html = await server.renderDocument({ default: App });
    document.body.innerHTML = `<div id="app">${bodyOf(html)}</div>`;
    internal.__resetHydrationData();
    calls.length = 0;
    const app = document.getElementById('app');
    quietly(() => core.hydrate(h(App, {}), app));
    assert.doesNotMatch(app.textContent, /Profile=SERVER-ONLY|Orders=PROFILE/);
    await tick(20);
    assert.deepEqual(texts(app), ['Profile=PROFILE OF ALICE', 'Orders=ORDERS OF ALICE']);
  });

  it('a client-only widget before the others never sees their data (the review\'s IBAN)', async () => {
    const { h, Suspense, createResource } = core;
    let showChatWidget = false;
    const seenByChat = [];
    function ChatWidget() {
      const [v] = createResource(() => tick().then(() => 'chat-config'));
      return h('aside', { id: 'chat' }, () => { seenByChat.push(v()); return `chat sees: ${JSON.stringify(v())}`; });
    }
    function Account() {
      const [v] = createResource(() => tick().then(() => ({ iban: 'DE89 3704 0044 0532 0130 00' })));
      return h('p', { id: 'acct' }, () => `account: ${JSON.stringify(v())}`);
    }
    function Promo() {
      const [v] = createResource(() => tick().then(() => '10% off'));
      return h('p', { id: 'promo' }, () => `promo: ${JSON.stringify(v())}`);
    }
    const App = () => h(Suspense, { fallback: 'loading' },
      h('div', null, showChatWidget ? h(ChatWidget, {}) : null, h(Account, {}), h(Promo, {})));
    const html = await server.renderDocument({ default: App });
    showChatWidget = true;
    document.body.innerHTML = `<div id="app">${bodyOf(html)}</div>`;
    internal.__resetHydrationData();
    quietly(() => core.hydrate(h(App, {}), document.getElementById('app')));
    await tick(30);
    assert.ok(!JSON.stringify(seenByChat).includes('iban'), `the chat widget saw ${JSON.stringify(seenByChat)}`);
    assert.deepEqual(texts(document.getElementById('app')), [
      'chat sees: "chat-config"',
      'account: {"iban":"DE89 3704 0044 0532 0130 00"}',
      'promo: "10% off"',
    ]);
  });

  it('a <Portal>\'s content exists only on the client and shifts nothing', async () => {
    const calls = [];
    const { h, Suspense, Portal } = core;
    const Inside = resourceComponent('Inside', 'INSIDE', calls);
    const After = resourceComponent('After', 'AFTER', calls);
    const target = document.createElement('div');
    target.id = 'portal-target';
    const App = () => h(Suspense, { fallback: 'fb' },
      h('div', null, h(Portal, { target: '#portal-target' }, h(Inside, {})), h(After, {})));
    const html = await server.renderDocument({ default: App });
    document.body.innerHTML = `<div id="app">${bodyOf(html)}</div>`;
    document.body.appendChild(target);
    internal.__resetHydrationData();
    calls.length = 0;
    quietly(() => core.hydrate(h(App, {}), document.getElementById('app')));
    await tick(20);
    assert.deepEqual(clientFetches(calls), ['Inside@client'], 'only the portal\'s own resource fetches');
    assert.equal(document.getElementById('after').textContent, 'After=AFTER');
  });
});

describe('several hydrate() roots', () => {
  it('two roots on one page, hydrated in reverse order, never swap their data', async () => {
    const calls = [];
    const { h, Suspense } = core;
    const Profile = resourceComponent('Profile', 'PROFILE OF ALICE', calls);
    const Orders = resourceComponent('Orders', 'ORDERS OF ALICE', calls);
    const Header = () => h(Suspense, { fallback: 'fb' }, h(Profile, {}));
    const Main = () => h(Suspense, { fallback: 'fb' }, h(Orders, {}));
    const Page = () => h('div', null, h('header', { id: 'h' }, h(Header, {})), h('section', { id: 'm' }, h(Main, {})));
    const html = await server.renderDocument({ default: Page });
    document.body.innerHTML = bodyOf(html);
    internal.__resetHydrationData();
    quietly(() => {
      core.hydrate(h(Main, {}), document.getElementById('m'));
      core.hydrate(h(Header, {}), document.getElementById('h'));
    });
    assert.doesNotMatch(document.body.textContent, /Profile=ORDERS|Orders=PROFILE/);
    await tick(20);
    assert.deepEqual(texts(document.body), ['Profile=PROFILE OF ALICE', 'Orders=ORDERS OF ALICE']);
  });

  it('an island adopts its own value from its server owner path, and not the page\'s', async () => {
    const calls = [];
    const { h, Suspense } = core;
    const Static = resourceComponent('Static', 'PAGE VALUE', calls);
    const Widget = resourceComponent('Widget', 'WIDGET VALUE', calls);
    const Page = () => h(Suspense, { fallback: '...' }, h('main', null,
      h(Static, {}),
      h(islands.Island, { name: 'widget', mode: 'load' }, h(Widget, {}))));
    const html = await server.renderDocument({ default: Page });
    assert.match(html, /data-what-owner="[0-9A-Za-z]+"/);
    document.body.innerHTML = bodyOf(html);
    internal.__resetHydrationData();
    calls.length = 0;
    islands.island('widget', () => ({ default: Widget }), { mode: 'load' });
    islands.hydrateIslands();
    await tick(30);
    assert.deepEqual(clientFetches(calls), [], 'the island refetched instead of adopting its own value');
    assert.equal(document.getElementById('widget').textContent, 'Widget=WIDGET VALUE');
    assert.equal(document.querySelector('[data-what-owner]'), null, 'the owner marker is cleaned up');
  });
});

describe('a renamed component is not trusted', () => {
  it('a client whose component names differ from the server\'s (a minified bundle) fetches', async () => {
    const calls = [];
    const { h, Suspense } = core;
    const ServerProfile = resourceComponent('Profile', 'SERVER', calls);
    const ClientProfile = resourceComponent('e', 'CLIENT', calls);
    const html = await server.renderDocument({ default: () => h(Suspense, { fallback: 'fb' }, h(ServerProfile, {})) });
    document.body.innerHTML = bodyOf(html);
    internal.__resetHydrationData();
    calls.length = 0;
    quietly(() => core.hydrate(h(() => h(Suspense, { fallback: 'fb' }, h(ClientProfile, {})), {}), document.body));
    await tick(20);
    assert.deepEqual(clientFetches(calls), ['e@client']);
  });
});
