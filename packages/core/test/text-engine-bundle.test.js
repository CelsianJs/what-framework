import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = resolve(__dirname, '../src');

function extractImports(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const importRe = /(?:import|export)\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
  const imports = [];
  let m;
  while ((m = importRe.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

function resolveLocal(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  return base.endsWith('.js') ? base : `${base}.js`;
}

function walkImports(entry, visited = new Set()) {
  if (visited.has(entry)) return visited;
  visited.add(entry);
  let imports;
  try {
    imports = extractImports(entry);
  } catch {
    return visited;
  }
  for (const spec of imports) {
    const resolved = resolveLocal(entry, spec);
    if (resolved) walkImports(resolved, visited);
  }
  return visited;
}

describe('text subpath isolation', () => {
  it('packages/core/src/index.js does not transitively import from src/text/', () => {
    const entry = resolve(SRC, 'index.js');
    const reachable = walkImports(entry);
    const textDir = resolve(SRC, 'text') + '/';
    const leaks = [...reachable].filter((p) => p.startsWith(textDir));
    assert.deepEqual(leaks, [],
      `The following files under src/text/ are reachable from src/index.js:\n${leaks.join('\n')}\n\n` +
      `This breaks the tree-shaking guarantee.`);
  });
});
