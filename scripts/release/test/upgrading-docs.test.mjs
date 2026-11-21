// The upgrade guide is rendered from data in three places (docs/UPGRADING.md,
// the tool table in docs/MCP-DEVTOOLS.md, and packages/what/UPGRADING.md, the
// copy what-framework ships) by scripts/generate-import-changes.mjs. These
// tests run in `npm test`, so a doc edited without `npm run docs:imports`, a
// copy that no longer ships, or a tool table that no longer matches the server
// fails here.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { renderAll, toolCount } from '../../generate-import-changes.mjs';
import { TOOL_CHANGES } from '../../../packages/devtools-mcp/src/tool-changes.js';
import { instrumentServer, getRegisteredTools, __resetToolRegistry } from '../../../packages/devtools-mcp/src/tool-registry.js';
import { registerTools } from '../../../packages/devtools-mcp/src/tools.js';
import { registerExtendedTools } from '../../../packages/devtools-mcp/src/tools-extended.js';
import { registerAgentTools } from '../../../packages/devtools-mcp/src/tools-agent.js';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

describe('the upgrade guide', () => {
  for (const [path, text] of renderAll()) {
    it(`${path} is what the generator renders`, () => {
      assert.ok(read(path) === text, `${path} is stale: run npm run docs:imports`);
    });
  }

  it('ships in what-framework as UPGRADING.md', () => {
    const [{ files }] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: new URL('packages/what/', root),
      encoding: 'utf8',
    }));
    assert.ok(files.some((f) => f.path === 'UPGRADING.md'), 'packages/what/package.json "files" must list UPGRADING.md');
  });

  it('links only to absolute URLs or its own headings in the shipped copy', () => {
    const relative = [...read('packages/what/UPGRADING.md').matchAll(/\]\(([^)\s]+)\)/g)]
      .map(([, target]) => target)
      .filter((target) => !/^https:\/\//.test(target) && !target.startsWith('#'));
    assert.deepEqual(relative, [], 'docs/ is not in the package, so a relative link from it is broken there');
  });
});

describe('the MCP tool table matches the server', () => {
  const params = new Map();
  __resetToolRegistry();
  const server = instrumentServer({ tool(name, _description, shape) { params.set(name, new Set(Object.keys(shape || {}))); } });
  const bridge = { isConnected: () => false };
  registerTools(server, bridge);
  registerExtendedTools(server, bridge);
  registerAgentTools(server, bridge);
  const registered = new Set(getRegisteredTools().map((t) => t.name));

  it('counts the tools the server registers', () => {
    assert.equal(toolCount(), registered.size);
  });

  it('names removed tools the server no longer registers, and added ones it does', () => {
    const removed = TOOL_CHANGES.removed.flatMap((c) => c.names);
    assert.deepEqual(removed.filter((name) => registered.has(name)), []);
    assert.deepEqual(TOOL_CHANGES.added.filter((name) => !registered.has(name)), []);
  });

  it('replaces each with calls the server accepts', () => {
    for (const call of TOOL_CHANGES.removed.flatMap((c) => c.use)) {
      const [, tool, args = ''] = call.match(/^(what_[a-z_]+)\((?:\{(.*)\})?\)$/) || [];
      assert.ok(registered.has(tool), `${call}: no such tool`);
      for (const key of args.split(',').map((part) => part.trim().match(/^(\w+)/)?.[1]).filter(Boolean)) {
        assert.ok(params.get(tool).has(key), `${call}: ${tool} takes no "${key}"`);
      }
    }
  });
});
