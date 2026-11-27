#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

// --help / --version print and exit BEFORE the MCP stdio transport starts.
const cliArgs = process.argv.slice(2);
if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
  console.log(`what-mcp ${pkg.version} — MCP server for What Framework documentation [DEPRECATED]

DEPRECATED: superseded by what-devtools-mcp (all documentation plus live
devtools). Install what-devtools-mcp and remove what-mcp from your MCP config.

Usage:
  what-mcp [flags]

Runs an MCP server on stdio (add it to your MCP client config). No other
arguments are accepted.

Flags:
  -h, --help       Show this help and exit
  -v, --version    Print the version and exit

Docs: https://whatfw.com`);
  process.exit(0);
}
if (cliArgs.includes('--version') || cliArgs.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

console.warn(
  '[what-mcp] DEPRECATED: This package is superseded by what-devtools-mcp, ' +
  'which includes all documentation plus live devtools. ' +
  'Install what-devtools-mcp and remove what-mcp from your MCP config.'
);

/**
 * What Framework MCP Server
 *
 * @deprecated Use what-devtools-mcp instead. This package is superseded by the unified MCP server.
 *
 * Answers each documentation topic with the what-devtools-mcp resource that
 * now covers it.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// The topic documentation this server carried taught the 0.12 API (imports
// from 'what' and 'what/server', the domain kits on the root entry) and is no
// longer maintained. what-devtools-mcp serves the current documentation as
// what://docs/* resources, so each topic answers with the resource that covers
// it rather than with code that no longer runs.
const OVERVIEW = `
What Framework is a lightweight, signals-based web framework.

Key features:
- Signals: Fine-grained reactivity without virtual DOM diffing
- Islands: Zero JS by default, hydrate components on demand
- ~9.29 kB gzipped: Tiny bundle size (measured: what-core in a counter app, min+gzip)
- React's hook names (useState, useEffect, useMemo), returning signals: call them to read
- File-based routing: Drop files in pages/, get routes
- SSR/SSG/Hybrid: Choose rendering mode per page
- TypeScript: Full type definitions included
`;

const TOPICS = {
  what_signals: ['signals and reactive primitives', 'what://docs/reactivity-model'],
  what_components: ['components and mounting', 'what://docs/api-reference'],
  what_hooks: ['hooks', 'what://docs/api-reference'],
  what_islands: ['islands and partial hydration', 'what://docs/ssr-ssg'],
  what_routing: ['routing', 'what://docs/routing'],
  what_forms: ['forms and validation', 'what://docs/api-reference'],
  what_data_fetching: ['data fetching', 'what://docs/api-reference'],
  what_animation: ['animation', 'what://docs/api-reference'],
  what_accessibility: ['accessibility', 'what://docs/api-reference'],
  what_skeleton: ['skeletons and loading states', 'what://docs/api-reference'],
  what_ssr: ['server rendering and static generation', 'what://docs/ssr-ssg'],
  what_cli: ['the CLI and configuration', 'what://docs/cli'],
};

function pointer(resource) {
  return `The current documentation is served by what-devtools-mcp (\`npx what-devtools-mcp\` in your MCP config): read the resource ${resource}. A project that has what-framework installed also has it offline, in node_modules/what-framework/skills/what/SKILL.md.`;
}

function moved(topic, resource) {
  return `[what-mcp is deprecated] Its documentation on ${topic} described the 0.12 API and has been removed.\n\n${pointer(resource)}`;
}

// Create server
const server = new Server(
  {
    name: 'what-framework',
    version: pkg.version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'what_overview',
        description: 'Get an overview of What Framework',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_signals',
        description: 'Learn about signals and reactive primitives in What Framework',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_components',
        description: 'Learn about creating components and the h() function',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_hooks',
        description: 'Learn about React-compatible hooks (useState, useEffect, etc.)',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_islands',
        description: 'Learn about islands architecture and partial hydration',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_routing',
        description: 'Learn about file-based and programmatic routing',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_forms',
        description: 'Learn about form utilities and validation',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_data_fetching',
        description: 'Learn about data fetching with useSWR and useQuery',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_animation',
        description: 'Learn about animation primitives (spring, tween, gestures)',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_accessibility',
        description: 'Learn about accessibility utilities',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_skeleton',
        description: 'Learn about skeleton loaders and loading states',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_ssr',
        description: 'Learn about server-side rendering and static generation',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_cli',
        description: 'Learn about CLI commands and configuration',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_search',
        description: 'Search across all What Framework documentation',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
          },
          required: ['query'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const answer = (text) => ({ content: [{ type: 'text', text }] });

  if (name === 'what_overview') return answer(OVERVIEW);
  if (Object.hasOwn(TOPICS, name)) return answer(moved(...TOPICS[name]));
  if (name === 'what_search') {
    const query = String(args?.query ?? '').toLowerCase();
    const hits = Object.values(TOPICS).filter(([topic]) => topic.includes(query));
    return answer(hits.length
      ? hits.map(([topic, resource]) => moved(topic, resource)).join('\n\n---\n\n')
      : `No what-mcp topic matches "${query}". ${pointer('what://docs/api-reference')}`);
  }
  // ERROR_CODES.UNKNOWN_TOOL
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'ERR_UNKNOWN_TOOL' });
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('What Framework MCP Server running on stdio');
}

main().catch(console.error);
