// The what://docs/* resources and the prompt, read through an MCP client the
// way an agent reads them. Their code blocks are compiled, import-checked and
// run by the documentation snippet gate (scripts/docs/test/snippets.test.mjs);
// this file pins what the gate cannot see: the statements made in prose.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { HOOKS_CONTRACT } from '../src/agent-docs.js';
import { RESOURCES, PROMPTS, registerResources } from '../src/resources.js';

async function connect(toolCount = 7) {
  const server = new McpServer({ name: 'test-resources', version: '0.1.0' });
  registerResources(server, { toolCount: () => toolCount });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.1.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const text = (uri) => RESOURCES.find((r) => r.uri === uri).text();

describe('what-devtools-mcp resources', () => {
  it('serves every resource with the text resources.js renders', async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    assert.deepEqual(resources.map((r) => r.uri).sort(), RESOURCES.map((r) => r.uri).sort());
    assert.equal(new Set(RESOURCES.map((r) => r.uri)).size, RESOURCES.length, 'resource URIs are unique');
    for (const r of RESOURCES) {
      const { contents } = await client.readResource({ uri: r.uri });
      assert.equal(contents[0].mimeType, 'text/markdown');
      assert.equal(contents[0].text, r.text(), r.uri);
      assert.ok(contents[0].text.length > 200, `${r.uri} is not empty`);
    }
    await client.close();
  });

  it('serves the prompt with the number of tools the server registered', async () => {
    const client = await connect(24);
    const { prompts } = await client.listPrompts();
    assert.deepEqual(prompts.map((p) => p.name), PROMPTS.map((p) => p.name));
    const { messages } = await client.getPrompt({ name: 'what-devtools-guide' });
    assert.match(messages[0].content.text, /You have 24 MCP tools/);
    await client.close();
  });

  it('teaches the hooks contract in the API reference and the agent guide', () => {
    for (const uri of ['what://docs/api-reference', 'what://docs/agent-guide']) {
      assert.ok(text(uri).includes(HOOKS_CONTRACT), `${uri} includes HOOKS_CONTRACT`);
      assert.doesNotMatch(text(uri), /mean what they mean in React/, uri);
    }
  });

  it('states where onCleanup attaches, effect runs included', () => {
    assert.ok(text('what://docs/api-reference').includes(
      'runs when the component unmounts, or else when the reactive owner around the call is disposed (`createRoot`, a list row, a run of an effect: before its next run and when it is disposed)',
    ));
  });

  it('documents the real signatures of the APIs the review found misdocumented', () => {
    const api = text('what://docs/api-reference');
    assert.match(api, /useQuery\(\{ queryKey, queryFn/);
    assert.match(api, /useInfiniteQuery\(\{ queryKey, queryFn, initialPageParam, getNextPageParam \}\)/);
    assert.match(api, /`nextFrame\(\)`: a promise/);
    assert.match(api, /`raf\(key, fn\)`/);
    assert.match(api, /<Head title="/);
    assert.match(api, /`useTransition\(\)`: React's `\[isPending, startTransition\]`; `isPending\(\)` is an accessor/);
    assert.match(api, /`useOptimistic\(state, update\?\)`: React 19's `\[optimistic, addOptimistic\]`/);
    assert.match(api, /`settled\(\)`: resolves once nothing is queued, fetching or in a transition/);
    assert.match(api, /`hydrate\(node, container, \{ onHydrationError \}\?\)`: .*returns the unmount function/);
    for (const uri of RESOURCES.map((r) => r.uri).filter((u) => u !== 'what://docs/error-codes')) {
      const t = text(uri);
      assert.doesNotMatch(t, /each=\{\w+\(\)\}/, `${uri} passes the accessor to <For each>`);
      assert.doesNotMatch(t, /<Head><title>/, `${uri} uses <Head title>`);
      assert.doesNotMatch(t, /from 'what(?:\/[\w-]+)?'/, `${uri} imports from what-framework`);
    }
  });

  it('does not claim that a bare signal child renders as a function', () => {
    const guide = text('what://docs/agent-guide');
    assert.doesNotMatch(guide, /\[Function\]/);
    assert.match(guide, /<span>\{count\}<\/span>/);
    assert.match(guide, /<!-- snippet: bad run=ERR_MISSING_SIGNAL_READ -->/);
  });

  it('describes the APIs that exist: RenderStream, nested routes, the CLI config it reads', () => {
    assert.match(text('what://docs/ssr-ssg'), /shellReady, allReady, pipe, readable, abort, response/);
    assert.doesNotMatch(text('what://docs/routing'), /beforeEnter|route\.path\(\)/);
    assert.doesNotMatch(text('what://docs/cli'), /islands: true|port: 3000/);
    assert.doesNotMatch(text('what://docs/project-structure'), /\.island = true/);
  });
});
