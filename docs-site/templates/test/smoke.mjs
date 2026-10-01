import assert from 'node:assert/strict';
import { buildGuideUrl, sourceUrl, validateCatalog } from '../catalog.mjs';
import { PHASE_LABELS } from '../status.mjs';

const args = process.argv.slice(2);
const baseArg = args.indexOf('--base');
const countArg = args.indexOf('--expected-count');
const base = new URL(baseArg === -1 ? 'https://whatfw.com' : args[baseArg + 1]);
assert.ok(['http:', 'https:'].includes(base.protocol), 'base must be an HTTP URL');
const expectedCount = countArg === -1 ? undefined : Number(args[countArg + 1]);
const statusCountArg = args.indexOf('--expected-status-count');
const expectedStatusCount = statusCountArg === -1 ? undefined : Number(args[statusCountArg + 1]);
if (expectedCount !== undefined) assert.ok(Number.isInteger(expectedCount) && expectedCount >= 0, 'expected count must be a nonnegative integer');
if (expectedStatusCount !== undefined) assert.ok(Number.isInteger(expectedStatusCount) && expectedStatusCount >= 0, 'expected status count must be a nonnegative integer');

async function get(url, kind) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'WhatFrameworkStarterReleaseCheck/1.0' } });
  assert.equal(response.status, 200, `${url}: expected HTTP 200, got ${response.status}`);
  if (kind) assert.ok(response.headers.get('content-type')?.includes(kind), `${url}: expected ${kind}`);
  return response;
}

const gallery = await (await get(new URL('/templates/', base), 'text/html')).text();
const agents = await (await get(new URL('/templates/agents/', base), 'text/html')).text();
const catalog = await (await get(new URL('/templates/catalog.json', base), 'application/json')).json();
const status = await (await get(new URL('/templates/status.json', base), 'application/json')).json();
const statusHtml = await (await get(new URL('/templates/status/', base), 'text/html')).text();
assert.ok(Array.isArray(catalog.templates), 'public catalog must contain templates');
validateCatalog({ version: catalog.version, templates: catalog.templates.map(({ sourceUrl: _source, buildGuideUrl: _guide, ...template }) => template) });
assert.ok(catalog.templates.every(template => template.status === 'published'), 'draft entries must not be public');
if (expectedCount !== undefined) assert.equal(catalog.templates.length, expectedCount, 'published count');
assert.equal((gallery.match(/data-template\s/g) || []).length, catalog.templates.length, 'HTML/metadata count');
assert.match(gallery, /<h1>Start with something/);
assert.match(agents, /<h1>Read the pattern/);
assert.ok(/<title>Starter build status/.test(statusHtml), 'status page identity');
assert.ok(Array.isArray(status.entries), 'status data must contain entries');
if (expectedStatusCount !== undefined) assert.equal(status.entries.length, expectedStatusCount, 'tracked status count');
assert.equal((statusHtml.match(/data-status-entry\s/g) || []).length, status.entries.length, 'status HTML/metadata count');
for (const entry of status.entries) {
  assert.ok(Object.hasOwn(PHASE_LABELS, entry.phase), `${entry.name}: unsupported phase`);
  assert.equal(entry.referencePath, `/templates/status/${entry.slug}`, `${entry.name}: status path`);
  if (entry.source.state === 'reserved') assert.equal(entry.sourceUrl, null, `${entry.name}: reserved source must not be linked`);
  if (entry.phase !== 'live') assert.equal(entry.demoUrl, null, `${entry.name}: unreleased demo must not be linked`);
  const journal = await (await get(new URL(entry.referencePath, base), 'text/html')).text();
  assert.match(journal, /Verification record/);
  assert.match(journal, /Build journal/);
}
for (const asset of ['/templates/gallery.css', '/templates/gallery.js', '/templates/llms.txt']) await get(new URL(asset, base));
for (const template of catalog.templates) {
  assert.equal(template.sourceUrl, sourceUrl(template), `${template.name}: source link`);
  assert.equal(template.buildGuideUrl, buildGuideUrl(template), `${template.name}: BUILD.md link`);
  for (const url of [template.release.demoUrl, template.release.buildUrl, template.sourceUrl, template.buildGuideUrl]) assert.ok(gallery.includes(url) || agents.includes(url), `${template.name}: missing public link ${url}`);
  await get(new URL(template.preview.src, base), 'image/');
  await get(template.release.demoUrl, 'text/html');
  await get(template.release.buildUrl, 'text/html');
  const readme = `https://raw.githubusercontent.com/CelsianJs/${template.slug}/${template.release.commitSha}/README.md`;
  const guide = `https://raw.githubusercontent.com/CelsianJs/${template.slug}/${template.release.commitSha}/BUILD.md`;
  assert.ok((await (await get(readme)).text()).trim().length > 100, `${template.name}: release README is missing`);
  assert.ok((await (await get(guide)).text()).trim().length > 100, `${template.name}: release BUILD.md is missing`);
  console.log(`PASS ${template.name}: preview, demo, /build, README and BUILD.md at ${template.release.commitSha.slice(0, 8)}`);
}
console.log(`PASS marketing starter release: ${catalog.templates.length} live entries, ${status.entries.length} tracked status journals, gallery/guide/assets/metadata consistent at ${base.origin}`);
