// Every document that teaches agents the tool set must name only tools the
// server registers, and every invocation it shows must use parameters the
// tool's schema accepts. A removed tool or a stale parameter left in a
// CLAUDE.md costs an agent a failed call, so they fail here instead.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { instrumentServer, getRegisteredTools, __resetToolRegistry, OFFLINE_TOOLS } from '../src/tool-registry.js';
import { registerTools } from '../src/tools.js';
import { registerExtendedTools } from '../src/tools-extended.js';
import { registerAgentTools } from '../src/tools-agent.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The site: its landing page, every docs page and the llms files agents
// fetch. They said "24 tools" for a release while the README said 25.
const SITE = [
  'docs-site/index.html',
  'docs-site/llms.txt',
  'docs-site/llms-full.txt',
  ...readdirSync(join(repo, 'docs-site/docs'), { recursive: true })
    .filter((file) => file.endsWith('.html'))
    .map((file) => join('docs-site/docs', file))
    .sort(),
];

const DOCS = [
  'CLAUDE.md',
  'docs/MCP-DEVTOOLS.md',
  'docs/AGENT-PATTERNS.md',
  'docs/GOTCHAS.md',
  ...SITE,
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

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// The tool counts a text states, as [kind, number, line]: `all` for "25
// tools", "25 live debugging tools" and "the 25-tool server", `offline` for
// "the four offline tools", `live` for "the other 21 need a live page",
// `others` for "`a`, `b`, `c`, and 22 other tools" (three named, the rest
// counted). Markup is read as its text. A
// line about an earlier release (the migration notes' "0.14.0 registered 29
// tools") is history and is skipped.
function toolCounts(text) {
  const found = [];
  for (const line of text.replace(/<[^>]+>/g, '').split('\n')) {
    if (/\b0\.1[0-4]\./.test(line)) continue;
    for (const m of line.matchAll(/\b(\d+)(?: (?:live )?(?:debugging )?(?:MCP )?tools\b|-tool\b)/g)) found.push(['all', Number(m[1]), line]);
    for (const m of line.matchAll(/\band (\d+) other tools\b/g)) found.push(['others', Number(m[1]), line]);
    for (const m of line.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten) offline tools\b/g)) found.push(['offline', WORDS[m[1]] ?? Number(m[1]), line]);
    for (const m of line.matchAll(/\bthe other (\d+) need a live page\b/g)) found.push(['live', Number(m[1]), line]);
  }
  return found;
}

// "25 tools" in a page a person or an agent reads is a claim about the
// registry; the README said 24 for a release, and the site and llms files
// drifted the same way.
describe('docs state the number of tools the server registers', () => {
  const count = registeredNames().size;
  const expected = { all: count, offline: OFFLINE_TOOLS.size, live: count - OFFLINE_TOOLS.size, others: count - 3 };
  for (const doc of ['README.md', 'GETTING-STARTED.md', 'docs/QUICKSTART.md', 'CLAUDE.md', 'docs/ARCHITECTURE.md', 'docs/MCP-DEVTOOLS.md', 'docs/UPGRADING.md', 'packages/devtools-mcp/README.md', 'packages/create-what/agent-instructions.js', ...SITE]) {
    it(doc, () => {
      const wrong = toolCounts(readFileSync(join(repo, doc), 'utf8'))
        .filter(([kind, n]) => n !== expected[kind])
        .map(([kind, n, line]) => `${kind} ${n}: ${line.trim().slice(0, 100)}`);
      assert.deepEqual(wrong, [], `${doc} states a tool count other than the registry's (${count} tools, ${expected.offline} offline)`);
    });
  }
});

describe('the tool-count reader', () => {
  it('reads every phrasing the docs use, and skips earlier releases', () => {
    const text = [
      'A live MCP server (25 tools) and <strong>24</strong> MCP tools.',
      '<p>The 25-tool MCP server.</p>',
      'only the four offline tools answer; the other 21 need a live page.',
      'It provides 24 live debugging tools.',
      'Use `what_a`, `what_b`, `what_c`, and 22 other tools.',
      '0.14.0 registered 29 tools.',
    ].join('\n');
    assert.deepEqual(toolCounts(text).map(([kind, n]) => [kind, n]), [['all', 25], ['all', 24], ['all', 25], ['offline', 4], ['live', 21], ['all', 24], ['others', 22]]);
  });
});

describe('the invocation parser', () => {
  it('finds keys in both spellings and in parameter tables', () => {
    assert.deepEqual(invocations('`what_events({ after: seq, types: ["write", "run"] })` and `what_errors {after, severity}`\n| `what_signals` | `filter` | string |'), [
      ['what_events', 'after'], ['what_events', 'types'], ['what_errors', 'after'], ['what_errors', 'severity'], ['what_signals', 'filter'],
    ]);
  });
});
