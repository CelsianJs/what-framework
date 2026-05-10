import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('deprecated what-mcp package still ships documentation tool topics', () => {
  const source = readFileSync('packages/mcp-server/src/index.js', 'utf8');
  assert.match(source, /ListToolsRequestSchema/);
  assert.match(source, /what_signals/);
  assert.match(source, /what_accessibility/);
  assert.match(source, /what_search/);
});
