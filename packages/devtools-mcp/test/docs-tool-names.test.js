// Every document that teaches agents the tool set must name only tools the
// server registers, and every invocation it shows must use parameters the
// tool's schema accepts. A removed tool or a stale parameter left in a
// CLAUDE.md costs an agent a failed call, so they fail here instead.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { instrumentServer, getRegisteredTools, __resetToolRegistry } from '../src/tool-registry.js';
import { registerTools } from '../src/tools.js';
import { registerExtendedTools } from '../src/tools-extended.js';
import { registerAgentTools } from '../src/tools-agent.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const DOCS = [
  'CLAUDE.md',
  'docs/MCP-DEVTOOLS.md',
  'docs/AGENT-PATTERNS.md',
  'docs/GOTCHAS.md',
  'docs-site/llms-full.txt',
  'docs-site/index.html',
  'packages/devtools-mcp/README.md',
  'packages/devtools-mcp/TOOL-PIPELINES.md',
  'packages/devtools-mcp/DESIGN.md',
  'packages/devtools-mcp/WEBMCP.md',
  'packages/devtools-mcp/src/index.js',
  'packages/devtools-mcp/src/resources.js',
  'packages/create-what/agent-instructions.js',
  'packages/create-what/index.js',
  'packages/what/skills/what/SKILL.md',
  'packages/what/skills/what-diagnostics/SKILL.md',
];

// what_* identifiers that are not MCP tools.
const NOT_TOOLS = new Set(['what_data', 'what_action', 'what_revalidate', 'what_mcp_token']);

const params = new Map(); // tool name -> parameter names from its schema

function registeredNames() {
  __resetToolRegistry();
  const server = instrumentServer({ tool(name, _description, shape) { params.set(name, new Set(Object.keys(shape || {}))); } });
  const bridge = { isConnected: () => false };
  registerTools(server, bridge);
  registerExtendedTools(server, bridge);
  registerAgentTools(server, bridge);
  return new Set(getRegisteredTools().map((t) => t.name));
}

// Invocations written as what_x({ a: 1, b }) or `what_x {a, b: true}`, and
// rows of a parameter table (| `what_x` | `param` |). Returns [tool, key] pairs.
function invocations(text) {
  const found = [];
  for (const [, tool, body] of text.matchAll(/(what_[a-z_]+)\\?`?\s*\(?\s*\{([^{}\n]*)\}/g)) {
    let depth = 0;
    let part = '';
    const parts = [];
    for (const ch of body) {
      if ('[('.includes(ch)) depth++;
      if ('])'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { parts.push(part); part = ''; } else part += ch;
    }
    parts.push(part);
    for (const p of parts) {
      const key = p.trim().replace(/\\/g, '').match(/^["']?([A-Za-z_]\w*)["']?\s*(?::|$)/)?.[1];
      if (key) found.push([tool, key]);
    }
  }
  for (const [, tool, key] of text.matchAll(/^\|\s*`(what_[a-z_]+)`\s*\|\s*`(\w+)`\s*\|/gm)) found.push([tool, key]);
  return found;
}

describe('agent-facing docs name only registered tools', () => {
  const tools = registeredNames();

  for (const doc of DOCS) {
    it(doc, () => {
      // The migration table in MCP-DEVTOOLS.md names removed tools on purpose,
      // each next to its replacement; that section is the one exemption.
      const text = readFileSync(join(repo, doc), 'utf8').replace(/### Removed after [\s\S]*?\n---\n/, '');
      const named = new Set([...text.matchAll(/(?<![\w])what_[a-z_]+/g)].map((m) => m[0]).filter((n) => !NOT_TOOLS.has(n)));
      const stale = [...named].filter((n) => !tools.has(n));
      assert.deepEqual(stale, [], `${doc} names tools the server does not register`);
      const wrong = invocations(text).filter(([tool, key]) => tools.has(tool) && !params.get(tool).has(key)).map(([tool, key]) => `${tool}.${key}`);
      assert.deepEqual(wrong, [], `${doc} shows parameters the tool does not accept`);
    });
  }
});

describe('the invocation parser', () => {
  it('finds keys in both spellings and in parameter tables', () => {
    assert.deepEqual(invocations('`what_events({ after: seq, types: ["write", "run"] })` and `what_errors {after, severity}`\n| `what_signals` | `filter` | string |'), [
      ['what_events', 'after'], ['what_events', 'types'], ['what_errors', 'after'], ['what_errors', 'severity'], ['what_signals', 'filter'],
    ]);
  });
});
