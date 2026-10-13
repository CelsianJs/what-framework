export const RUNTIME_LABELS = Object.freeze({
  static: 'Static',
  client: 'Client',
  hybrid: 'Hybrid',
  serverless: 'Serverless',
  server: 'Server-rendered',
});

const SLUG = /^what-starter-[a-z][a-z0-9-]*$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ASSET = /^\/templates\/previews\/[a-z0-9][a-z0-9-]*\.(?:png|webp|jpe?g)$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(`Starter catalog: ${message}`);
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fields(value, allowed, path) {
  requireValue(record(value), `${path} must be an object`);
  for (const key of Object.keys(value)) requireValue(allowed.includes(key), `${path}.${key} is not supported`);
}

function text(value, path, max = 240) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${path} must be nonempty text of at most ${max} characters`);
  requireValue([...value].every(character => character.charCodeAt(0) > 31), `${path} must not contain control characters`);
}

export function sourceUrl(template) {
  return `https://github.com/CelsianJs/${template.slug}`;
}

export function buildGuideUrl(template) {
  return `${sourceUrl(template)}/blob/main/BUILD.md`;
}

export function validateCatalog(catalog, { assetExists, now = Date.now() } = {}) {
  fields(catalog, ['version', 'templates'], 'catalog');
  requireValue(catalog.version === 1, 'version must be 1');
  requireValue(Array.isArray(catalog.templates), 'templates must be an array');
  const seen = new Set();
  for (const template of catalog.templates) {
    fields(template, ['slug', 'status', 'name', 'description', 'category', 'runtimes', 'features', 'architecture', 'preview', 'release'], 'template');
    requireValue(typeof template.slug === 'string' && SLUG.test(template.slug), 'slug must use the what-starter-* convention');
    const path = template.slug;
    requireValue(!seen.has(path), `duplicate slug ${path}`);
    seen.add(path);
    requireValue(['draft', 'published'].includes(template.status), `${path}.status must be draft or published`);
    for (const key of ['name', 'category']) text(template[key], `${path}.${key}`, 60);
    for (const key of ['description', 'architecture']) text(template[key], `${path}.${key}`);
    requireValue(Array.isArray(template.runtimes) && template.runtimes.length > 0, `${path}.runtimes must not be empty`);
    requireValue(new Set(template.runtimes).size === template.runtimes.length, `${path}.runtimes must be unique`);
    for (const runtime of template.runtimes) requireValue(Object.hasOwn(RUNTIME_LABELS, runtime), `${path}: unknown runtime ${runtime}`);
    requireValue(Array.isArray(template.features) && template.features.length > 0 && template.features.length <= 8, `${path}.features must contain 1–8 labels`);
    for (const feature of template.features) text(feature, `${path}.features`, 40);
    if (template.status === 'draft') {
      requireValue(template.release === null, `${path}: a draft must not carry release URLs`);
      continue;
    }
    fields(template.preview, ['src', 'alt', 'width', 'height', 'capturedAt'], `${path}.preview`);
    requireValue(ASSET.test(template.preview.src), `${path}.preview must use a local /templates/previews image`);
    text(template.preview.alt, `${path}.preview.alt`, 180);
    for (const key of ['width', 'height']) requireValue(Number.isInteger(template.preview[key]) && template.preview[key] > 0, `${path}.preview.${key} must be a positive integer`);
    if (assetExists) requireValue(assetExists(template.preview.src), `${path}.preview file does not exist: ${template.preview.src}`);
    fields(template.release, ['demoUrl', 'buildUrl', 'verifiedAt', 'deploymentId', 'commitSha'], `${path}.release`);
    let demo;
    try { demo = new URL(template.release.demoUrl); } catch { throw new Error(`Starter catalog: ${path}.release.demoUrl must be a valid URL`); }
    requireValue(demo.protocol === 'https:' && demo.hostname.endsWith('.vura.app') && !demo.username && !demo.password && demo.pathname === '/' && !demo.search && !demo.hash, `${path}.release.demoUrl must be an HTTPS Vura app root`);
    requireValue(template.release.buildUrl === `${demo.origin}/build`, `${path}.release.buildUrl must be the verified demo /build page`);
    const verifiedAt = Date.parse(template.release.verifiedAt);
    requireValue(typeof template.release.verifiedAt === 'string' && Number.isFinite(verifiedAt) && verifiedAt <= now, `${path}.release.verifiedAt must be a past verification time`);
    if (Object.hasOwn(template.preview, 'capturedAt')) {
      const capturedAt = Date.parse(template.preview.capturedAt);
      requireValue(typeof template.preview.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(template.preview.capturedAt) && Number.isFinite(capturedAt) && capturedAt <= verifiedAt && capturedAt <= now, `${path}.preview.capturedAt must be a past capture time no newer than release verification`);
    }
    requireValue(UUID.test(template.release.deploymentId), `${path}.release.deploymentId must be a deployment UUID`);
    requireValue(/^[a-f0-9]{40}$/i.test(template.release.commitSha), `${path}.release.commitSha must be a full commit SHA`);
  }
  return catalog;
}

export function publishedTemplates(catalog) {
  return catalog.templates.filter(template => template.status === 'published');
}

export function publicCatalog(catalog) {
  return {
    version: catalog.version,
    templates: publishedTemplates(catalog).map(template => ({ ...template, sourceUrl: sourceUrl(template), buildGuideUrl: buildGuideUrl(template) })),
  };
}

export function catalogLlms(catalog) {
  const entries = publishedTemplates(catalog).map(template =>
    `## ${template.name}\n\n${template.description}\n\nArchitecture: ${template.architecture}\n\n- Demo: ${template.release.demoUrl}\n- In-app build guide: ${template.release.buildUrl}\n- Source: ${sourceUrl(template)}\n- Agent reference: ${buildGuideUrl(template)}\n- Verified commit: ${template.release.commitSha}`);
  return `# What Framework starters\n\nStandalone What apps hosted on Vura. Start with the repository README and BUILD.md; those documents explain the implemented signals, effects, global state, routing, deployment and limitations.\n\n- Gallery: https://whatfw.com/templates\n- Agent workflow: https://whatfw.com/templates/agents\n- Build status and journals: https://whatfw.com/templates/status\n- Release metadata: https://whatfw.com/templates/catalog.json\n\n${entries.join('\n\n')}\n`;
}
