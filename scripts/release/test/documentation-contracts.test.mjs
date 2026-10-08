import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import plugin from '../../../packages/eslint-plugin/src/index.js';

const root = new URL('../../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('published lint configuration examples match each actual preset', () => {
  const readme = read('packages/eslint-plugin/README.md');
  for (const [name, config] of Object.entries(plugin.configs)) {
    const section = readme.split(`### ${name}\n`)[1];
    assert.ok(section, `Missing ${name} documentation`);
    const snippet = section.match(/```js\n([\s\S]*?)\n```/)?.[1];
    assert.ok(snippet, `Missing ${name} code example`);
    const example = runInNewContext(`(${snippet})`, {}, { timeout: 1000 });
    assert.deepEqual(JSON.parse(JSON.stringify(example)), config.rules, name);
  }
});

test('release checklist names the maintained cohort and preserves the frozen package', () => {
  const checklist = read('docs/RELEASE-CHECKLIST.md');
  const packages = readdirSync(new URL('packages/', root), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => JSON.parse(read(`packages/${entry.name}/package.json`)));
  const maintained = packages.filter(pkg => !pkg.private && pkg.name !== 'what-mcp');
  assert.equal(maintained.length, 13);
  for (const pkg of maintained) assert.ok(checklist.includes(`\`${pkg.name}\``), pkg.name);
  assert.match(checklist, /what-mcp` frozen at 0\.12\.4/);
  assert.match(checklist, /WHAT_REGISTRY_TAG=next/);
  assert.doesNotMatch(checklist, /Push to `main`|Bump ALL 12/);
});

test('agent guides describe function bindings as tracked effects', () => {
  for (const path of ['CLAUDE.md', 'packages/create-what/index.js']) {
    const guide = read(path).replace(/\s+/g, ' ');
    assert.doesNotMatch(guide, /bypassing tracked effects|without going through tracked effects|more common than tracked effects/, path);
    assert.match(guide, /Initial (?:runs|execution) (?:are|is) reported/, path);
  }
});
