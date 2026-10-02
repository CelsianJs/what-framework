import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildGuideUrl, catalogLlms, publicCatalog, publishedTemplates, sourceUrl, validateCatalog } from '../catalog.mjs';
import { renderAgentGuide, renderGallery } from '../render.mjs';

const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
const published = () => ({
  ...structuredClone(catalog.templates[0]),
  status: 'published',
  preview: { src: '/templates/previews/tempo.webp', alt: 'Tempo time tracking workspace', width: 1440, height: 900 },
  release: { demoUrl: 'https://tempo-fixture.vura.app/', buildUrl: 'https://tempo-fixture.vura.app/build', verifiedAt: '2026-09-30T16:00:00.000Z', deploymentId: '11111111-2222-3333-4444-555555555555', commitSha: 'a'.repeat(40) },
});
const one = () => ({ version: 1, templates: [published()] });

test('source catalog is valid and slugs are unique', () => {
  assert.equal(validateCatalog(catalog), catalog);
  assert.equal(new Set(catalog.templates.map(template => template.slug)).size, catalog.templates.length);
});

test('unpublished entries never appear in public HTML, JSON or retrieval index', () => {
  const draft = { ...structuredClone(catalog.templates.find(template => template.slug === 'what-starter-launchpad')), name: 'PRIVATE DRAFT SENTINEL', status: 'draft', release: null };
  const mixed = { version: 1, templates: [published(), draft] };
  assert.equal(publishedTemplates(mixed).length, 1);
  for (const output of [renderGallery(mixed, '0.13.10'), renderAgentGuide(mixed, '0.13.10'), JSON.stringify(publicCatalog(mixed)), catalogLlms(mixed)]) {
    assert.doesNotMatch(output, /PRIVATE DRAFT SENTINEL/);
    assert.doesNotMatch(output, /what-starter-launchpad/);
  }
});

test('published entries require a real release record and local screenshot', () => {
  assert.doesNotThrow(() => validateCatalog(one(), { assetExists: () => true }));
  assert.throws(() => validateCatalog(one(), { assetExists: () => false }), /file does not exist/);
  const value = one();
  value.templates[0].release = null;
  assert.throws(() => validateCatalog(value), /release must be an object/);
});

test('preview capture times are optional, real past timestamps no newer than release verification', () => {
  const value = one();
  value.templates[0].preview.capturedAt = '2026-09-30T15:55:00.000Z';
  assert.doesNotThrow(() => validateCatalog(value));
  assert.match(renderGallery(value, '0.13.10'), /Preview captured/);
  assert.match(renderGallery(value, '0.13.10'), /datetime="2026-09-30T15:55:00.000Z"/);
  for (const timestamp of ['not-a-date', '2999-01-01T00:00:00.000Z', '2026-09-30T16:01:00.000Z']) {
    value.templates[0].preview.capturedAt = timestamp;
    assert.throws(() => validateCatalog(value), /capturedAt/);
  }
  delete value.templates[0].preview.capturedAt;
  assert.doesNotThrow(() => validateCatalog(value));
  assert.doesNotMatch(renderGallery(value, '0.13.10'), /Preview captured/);
});

test('rejects unknown metadata, malformed identity and unsupported rendering labels', () => {
  const unknown = one(); unknown.templates[0].prompt = 'not public content';
  assert.throws(() => validateCatalog(unknown), /prompt is not supported/);
  const duplicate = one(); duplicate.templates.push(published());
  assert.throws(() => validateCatalog(duplicate), /duplicate slug/);
  const runtime = one(); runtime.templates[0].runtimes = ['pretend-runtime'];
  assert.throws(() => validateCatalog(runtime), /unknown runtime/);
  const slug = one(); slug.templates[0].slug = '../escape';
  assert.throws(() => validateCatalog(slug), /slug must use/);
});

test('rejects credential, script, external, path and future verification URLs', () => {
  for (const url of ['http://tempo.vura.app/', 'javascript:alert(1)', 'https://example.com/', 'https://user:password@tempo.vura.app/', 'https://tempo.vura.app/another', 'https://tempo.vura.app/?token=secret']) {
    const value = one(); value.templates[0].release.demoUrl = url;
    assert.throws(() => validateCatalog(value), /demoUrl/);
  }
  const value = one(); value.templates[0].release.verifiedAt = '2999-01-01T00:00:00Z';
  assert.throws(() => validateCatalog(value), /past verification time/);
});

test('requires the same deployed origin for the build guide and full release identifiers', () => {
  for (const [key, value] of [['buildUrl', 'https://elsewhere.vura.app/build'], ['deploymentId', 'not-a-deployment'], ['commitSha', 'abc123']]) {
    const invalid = one(); invalid.templates[0].release[key] = value;
    assert.throws(() => validateCatalog(invalid), new RegExp(key));
  }
  const remote = one(); remote.templates[0].preview.src = 'https://example.com/preview.png';
  assert.throws(() => validateCatalog(remote), /local/);
});

test('public links, source and clone instructions come from one release', () => {
  const value = one();
  const template = value.templates[0];
  const html = renderGallery(value, '0.13.10');
  assert.equal(sourceUrl(template), 'https://github.com/CelsianJs/what-starter-tempo');
  assert.equal(buildGuideUrl(template), `${sourceUrl(template)}/blob/main/BUILD.md`);
  for (const content of [template.release.demoUrl, template.release.buildUrl, buildGuideUrl(template), `git clone ${sourceUrl(template)}.git`, 'npm ci', 'data-gallery-controls', 'role="status"']) assert.ok(html.includes(content), content);
  assert.match(html, /width="1440" height="900"/);
  assert.match(renderAgentGuide(value, '0.13.10'), /uploads <code>dist\/.*does not build it/);
  assert.doesNotMatch(renderAgentGuide(value, '0.13.10'), /projects list/);
});

test('display text is escaped instead of interpreted as HTML', () => {
  const value = one(); value.templates[0].name = '<script>alert("bad")</script>';
  const html = renderGallery(value, '0.13.10');
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('an empty published catalog gives useful paths instead of dummy cards', () => {
  const html = renderGallery({ version: 1, templates: [] }, '0.13.10');
  assert.match(html, /Start with a working pattern/);
  assert.doesNotMatch(html, /data-template|coming soon|skeleton/i);
  assert.match(html, /href="\/docs\/learn\/"/);
});
