import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { STARTER_LEARNING, validateLearning } from '../learning.mjs';

const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));

test('curated journeys retain bounded, public-safe examples with complete source maps', () => {
  assert.equal(validateLearning(catalog), STARTER_LEARNING);
  assert.equal(Object.keys(STARTER_LEARNING).length, 18);
  for (const [slug, learning] of Object.entries(STARTER_LEARNING)) {
    const paths = learning.sourceFiles.map(source => source.path);
    assert.equal(new Set(paths).size, paths.length, `${slug}: duplicate source path`);
    assert.ok(learning.smooth.length > 0 && learning.issues.length > 0, `${slug}: incomplete journey`);
    for (const example of learning.examples) {
      assert.ok(paths.includes(example.path), `${slug}: example absent from source map: ${example.path}`);
    }
  }
});

// A release check supplies a directory containing all starter checkouts. Normal
// docs-only test runs still validate metadata without requiring those repositories.
const sourceRoot = process.env.STARTER_SOURCE_ROOT;
test('every curated path has exact source casing and every example is literal', { skip: !sourceRoot }, () => {
  for (const [slug, learning] of Object.entries(STARTER_LEARNING)) {
    const root = resolve(sourceRoot, slug);
    for (const source of learning.sourceFiles) {
      let directory = root;
      for (const part of source.path.split('/')) {
        assert.ok(readdirSync(directory).includes(part), `${slug}: source casing or membership: ${source.path}`);
        directory = join(directory, part);
      }
    }
    for (const example of learning.examples) {
      const source = readFileSync(join(root, example.path), 'utf8');
      assert.ok(source.includes(example.code), `${slug}: nonliteral example: ${example.title}`);
    }
  }
});
