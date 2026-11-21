/**
 * Every what_scaffold type, generated through the real tool, must compile with
 * what-compiler, run against the real runtime, behave as its comments say, and
 * pass what_lint with no issues.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { registerAgentTools } from '../src/tools-agent.js';

installDOM();
const core = await import('what-framework');

let client;
let server;

before(async () => {
  server = new McpServer({ name: 'scaffold-smoke', version: '0.0.0' });
  registerAgentTools(server, null);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

after(async () => {
  await client.close();
  await server.close();
});

async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  return JSON.parse(result.content[0].text);
}

// `harness` is JSX appended to the module, so a parent passes props the way
// compiled code does: the attribute's value as written, an accessor for
// label={label}. `edit` rewrites the generated code before it is checked.
async function scaffold(type, extra = {}, harness = '', edit = (code) => code) {
  const out = await call('what_scaffold', { type, name: 'Sample', ...extra });
  const code = edit(out.code);
  const lint = await call('what_lint', { code });
  assert.equal(lint.compiled, true, code);
  assert.equal(lint.lint, true);
  assert.deepEqual(lint.issues, [], `${type} scaffold must lint clean:\n${code}`);
  return { ...out, code, module: await loadCompiled(code + harness) };
}

function mountInto(vnode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = core.mount(vnode, host);
  return { host, dispose: () => { dispose(); host.remove(); } };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('what_scaffold output runs', () => {
  it('store: the hook exposes state and working actions', async () => {
    const { module, path } = await scaffold('store', { signals: ['items', 'filter'] });
    assert.equal(path, 'src/stores/sample.js');
    const store = module.default();
    store.addItem('one');
    store.setFilter('done');
    assert.deepEqual(store.items, ['one']);
    assert.equal(store.itemCount, 1);
    assert.equal(store.filter, 'done');
  });

  const PARENT = "\nconst label = signal('first');\nexport const setLabel = (v) => label(v);\nexport function Parent() { return <Sample label={label} />; }\n";

  it('component: a signal prop stays live and signals render', async () => {
    const { module } = await scaffold('component', { props: ['label'], signals: ['count'] }, PARENT);
    const { host, dispose } = mountInto(core.h(module.Parent, {}));
    try {
      assert.match(host.textContent, /label: first/);
      module.setLabel('second');
      core.flushSync();
      assert.match(host.textContent, /label: second/, 'a prop change reaches the DOM');
      assert.match(host.textContent, /count: /);
    } finally {
      dispose();
    }
  });

  it('component: destructured, the same accessor prop stays live and lints clean', async () => {
    const destructure = (code) => code.replace('function Sample(props)', 'function Sample({ label })').replaceAll('props.label()', 'label()');
    const { module, code } = await scaffold('component', { props: ['label'], signals: ['count'] }, PARENT, destructure);
    assert.match(code, /function Sample\(\{ label \}\)/);
    const { host, dispose } = mountInto(core.h(module.Parent, {}));
    try {
      assert.match(host.textContent, /label: first/);
      module.setLabel('second');
      core.flushSync();
      assert.match(host.textContent, /label: second/, 'a destructured accessor is the same function');
    } finally {
      dispose();
    }
  });

  it('page: sets the document title, declares what it uses and finishes loading on mount', async () => {
    const { module } = await scaffold('page', { signals: ['items'] });
    document.title = 'before';
    const { host, dispose } = mountInto(core.h(module.default, {}));
    try {
      assert.equal(document.title, 'Sample');
      core.flushSync();
      await tick();
      assert.match(host.textContent, /Ready/);
    } finally {
      dispose();
    }
  });

  it('form: validates, shows errors, then submits the values', async () => {
    const { module } = await scaffold('form', { signals: ['email'] });
    const submitted = [];
    const { host, dispose } = mountInto(core.h(module.default, { onSubmit: (values) => submitted.push(values) }));
    try {
      const form = host.querySelector('form');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await tick();
      core.flushSync();
      assert.match(host.textContent, /Email is required/);
      const input = host.querySelector('input');
      input.value = 'a@b.co';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await tick();
      await tick();
      assert.deepEqual(submitted, [{ email: 'a@b.co' }]);
    } finally {
      dispose();
    }
  });

  it('island: renders its props and toggles on click', async () => {
    const { module } = await scaffold('island', { props: ['title'] });
    const { host, dispose } = mountInto(core.h(module.default, { title: 'Hi' }));
    try {
      assert.match(host.textContent, /title: Hi/);
      const button = host.querySelector('button');
      assert.equal(button.textContent, 'Off');
      button.click();
      core.flushSync();
      assert.equal(button.textContent, 'On');
    } finally {
      dispose();
    }
  });
});
