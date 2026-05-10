import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as devtools from 'what-devtools';

const expectedPublicFunctions = [
  'installDevTools',
  'safeSerialize',
  'registerSignal',
  'notifySignalUpdate',
  'unregisterSignal',
  'registerEffect',
  'registerComponent',
  'unregisterComponent',
  'captureError',
  'getSnapshot',
  'getErrors',
  'getHydrationMismatches',
  'subscribe',
  'resetDevTools',
];

test('what-devtools runtime exports match declared public API', async () => {
  const typeDefs = await readFile(resolve('packages/devtools/index.d.ts'), 'utf8');
  const declaredFunctions = [...typeDefs.matchAll(/^export function (\w+)/gm)].map((match) => match[1]);

  assert.deepStrictEqual(declaredFunctions.sort(), expectedPublicFunctions.toSorted());

  for (const name of expectedPublicFunctions) {
    assert.equal(typeof devtools[name], 'function', `${name} should be exported at runtime`);
  }
});

test('public diagnostics helpers capture and reset runtime state', () => {
  devtools.resetDevTools();

  devtools.captureError(new Error('smoke'), 'smoke_test');

  const errors = devtools.getErrors();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'smoke');
  assert.equal(errors[0].type, 'smoke_test');

  const snapshot = devtools.getSnapshot();
  assert.equal(snapshot.errors.length, 1);
  assert.deepStrictEqual(devtools.getHydrationMismatches(), []);

  devtools.resetDevTools();
  assert.deepStrictEqual(devtools.getErrors(), []);
});
