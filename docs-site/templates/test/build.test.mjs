import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { publishedTemplates } from '../catalog.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
const status = JSON.parse(readFileSync(new URL('../status.json', import.meta.url), 'utf8'));

test('marketing build emits gallery, agent guide, assets and verified-only metadata', () => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'pipe' });
  const read = path => readFileSync(new URL(`../../dist/${path}`, import.meta.url), 'utf8');
  const gallery = read('templates/index.html');
  const agents = read('templates/agents/index.html');
  const metadata = JSON.parse(read('templates/catalog.json'));
  assert.equal(metadata.templates.length, publishedTemplates(catalog).length);
  assert.match(gallery, /<h1>Start with something/);
  assert.match(agents, /<h1>Read the pattern/);
  assert.ok(read('templates/gallery.css').length > 0);
  assert.ok(read('templates/gallery.js').length > 0);
  assert.match(read('templates/llms.txt'), /Agent workflow/);
  const statusData = JSON.parse(read('templates/status.json'));
  assert.equal(statusData.entries.length, catalog.templates.length);
  assert.match(read('templates/status/index.html'), /<h1>Starter build status/);
  assert.match(read('templates/status/llms.txt'), /Plans and build updates are not live releases/);
  for (const entry of status.entries) {
    assert.match(read(`templates/status/${entry.slug}/index.html`), /Verification record/);
    assert.match(read(`templates/status/${entry.slug}/index.html`), /Build journal/);
  }
  for (const draft of catalog.templates.filter(template => template.status === 'draft')) {
    for (const output of [gallery, agents, JSON.stringify(metadata), read('templates/llms.txt')]) assert.ok(!output.includes(draft.slug), draft.slug);
  }
  for (const path of ['index.html', 'docs/index.html', 'docs/learn/signals/index.html']) assert.match(read(path), /href="\/templates/);
});
