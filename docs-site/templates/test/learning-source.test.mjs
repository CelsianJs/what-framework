import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

test('each application maps its stylesheet and retains a bounded styling lesson', () => {
  for (const [slug, learning] of Object.entries(STARTER_LEARNING)) {
    const stylesheet = ['what-starter-launchpad', 'what-starter-marginalia'].includes(slug)
      ? 'src/shared/site.css'
      : slug === 'what-starter-signal' ? 'src/site/styles.css' : 'src/styles.css';
    assert.ok(learning.sourceFiles.some(source => source.path === stylesheet), `${slug}: missing stylesheet source`);
    assert.ok(learning.smooth.length >= 4, `${slug}: missing appended styling lesson`);
    for (const example of learning.examples.filter(example => example.language === 'css')) {
      assert.equal(example.path, stylesheet, `${slug}: CSS example must use the mapped stylesheet`);
    }
  }
});

// A release check supplies a directory containing all starter checkouts. Normal
// docs-only test runs still validate metadata without requiring those repositories.
const sourceRoot = process.env.STARTER_SOURCE_ROOT;
test('every curated path has exact source casing and every example is literal', { skip: !sourceRoot }, () => {
  for (const [slug, learning] of Object.entries(STARTER_LEARNING)) {
    const root = resolve(sourceRoot, slug);
    const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0'));
    for (const source of learning.sourceFiles) {
      assert.ok(tracked.has(source.path), `${slug}: source path is not Git tracked: ${source.path}`);
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
