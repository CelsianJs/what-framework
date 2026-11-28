// The engines floor gate (scripts/check-node-floor.mjs) finds each kind of
// API newer than the floor, ignores prose and feature-detected uses, and
// passes over the repository as it stands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const { uses, enginesFloor } = await import('../../check-node-floor.mjs');
const labels = (source, floor = '20.0.0') => uses(source, floor).map((use) => use.label);

test('each API newer than the floor is found', () => {
  const planted = [
    ['const { promise } = Promise.withResolvers();', 'Promise.withResolvers'],
    ['Object.groupBy(rows, (r) => r.kind);', 'Object.groupBy / Map.groupBy'],
    ['await Array.fromAsync(stream);', 'Array.fromAsync'],
    ['a.isSubsetOf(b); a.union(b);', 'Set methods'],
    ['map.values().map((x) => x).toArray();', 'iterator helpers'],
    ['  using handle = open();', '`using` declarations'],
    ['RegExp.escape(text);', 'RegExp.escape'],
    ['URL.parse(href);', 'URL.parse'],
    ['process.getBuiltinModule("node:fs");', 'process.getBuiltinModule'],
    ['const dir = import.meta.dirname;', 'import.meta.dirname / filename'],
    ["import { styleText } from 'node:util';", 'util.styleText'],
  ];
  for (const [source, label] of planted) assert.deepEqual(labels(source), [label], source);
});

test('a 20.x minor API is too new for shipped code only', () => {
  assert.deepEqual(labels('import.meta.dirname', '20.0.0'), ['import.meta.dirname / filename']);
  assert.deepEqual(labels('import.meta.dirname', '20.999.999'), []);
  assert.deepEqual(labels('Promise.withResolvers()', '20.999.999'), ['Promise.withResolvers']);
});

test('prose, arrays, zod and feature detection are not uses', () => {
  assert.deepEqual(labels('// Promise.withResolvers() is Node 22\n/* Object.groupBy */'), []);
  assert.deepEqual(labels('Object.entries(x).map((e) => e); [...keys().map(f)];'), []);
  assert.deepEqual(labels("z.union([z.string(), z.number()]);"), []);
  assert.deepEqual(labels('// node-floor: guarded by typeof\nprocess.getBuiltinModule("node:async_hooks");'), []);
});

test('the floor is engines.node, and the repository passes', () => {
  assert.equal(enginesFloor(root), '20.0.0');
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/check-node-floor.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
