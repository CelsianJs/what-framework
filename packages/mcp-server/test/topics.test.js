// what-mcp is deprecated and frozen. Its topic tools used to answer with 0.12
// documentation (imports from 'what', the domain kits on the root entry) that
// fails against today's packages; each now answers with the what-devtools-mcp
// resource that covers the topic. Driven over stdio like a real MCP client.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const BIN = new URL('../src/index.js', import.meta.url).pathname;

describe('what-mcp topic tools', () => {
  let client;

  before(async () => {
    client = new Client({ name: 'test-client', version: '0.1.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN], stderr: 'pipe' }));
  });

  after(async () => {
    await client.close();
  });

  it('keeps every tool name an existing MCP config may call', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), [
      'what_overview', 'what_signals', 'what_components', 'what_hooks', 'what_islands', 'what_routing', 'what_forms',
      'what_data_fetching', 'what_animation', 'what_accessibility', 'what_skeleton', 'what_ssr', 'what_cli', 'what_search',
    ]);
  });

  it('answers a topic with the what-devtools-mcp resource that covers it', async () => {
    const routing = await client.callTool({ name: 'what_routing', arguments: {} });
    assert.match(routing.content[0].text, /what-devtools-mcp/);
    assert.match(routing.content[0].text, /what:\/\/docs\/routing/);
    const search = await client.callTool({ name: 'what_search', arguments: { query: 'forms' } });
    assert.match(search.content[0].text, /what:\/\/docs\/api-reference/);
    const none = await client.callTool({ name: 'what_search', arguments: { query: 'no such topic' } });
    assert.match(none.content[0].text, /No what-mcp topic matches "no such topic"/);
  });

  it('ships no code written against the 0.12 API', () => {
    const src = readFileSync(BIN, 'utf8');
    assert.doesNotMatch(src, /import\s[^;]*from '(?:what|what\/[\w-]+)'/);
    assert.doesNotMatch(src, /import \{[^}]*\b(?:useForm|useSWR|spring|Skeleton)\b[^}]*\} from 'what-framework'/);
  });
});
