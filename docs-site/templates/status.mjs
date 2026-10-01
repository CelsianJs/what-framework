import { buildGuideUrl, sourceUrl } from './catalog.mjs';
import { learningFor } from './learning.mjs';

export const PHASE_LABELS = Object.freeze({ planned: 'Planned', building: 'Building', local_verified: 'Local checks passed', review: 'In review', live: 'Live on Vura' });
export const RESULT_LABELS = Object.freeze({ passed: 'Passed', failed: 'Failed', pending: 'Pending', reported: 'Reported, not independently verified' });
const PRIVATE = /(?:\/(?:Users|home|private|tmp)\/|\bENG-\d+\b|\bBearer\s+[\w.-]{12,}|\b(?:npm_|cfut_|sk-)[\w-]{16,}|\beyJ[\w-]{30,}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|<\/?(?:system|instructions|analysis)>|system prompt|developer prompt|you are an autonomous|raw agent logs?)/i;

function requireValue(condition, message) {
  if (!condition) throw new Error(`Starter status: ${message}`);
}

function fields(value, allowed, path) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${path} must be an object`);
  for (const key of Object.keys(value)) requireValue(allowed.includes(key), `${path}.${key} is not supported`);
}

function publicText(value, path, max = 1200) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${path} must be nonempty public text`);
  requireValue([...value].every(character => character.charCodeAt(0) > 31), `${path} must not contain control characters`);
  requireValue(!PRIVATE.test(value), `${path} contains private, credential-like or instruction content`);
  requireValue(!/https?:\/\//i.test(value), `${path}: URLs belong in verified source/release records, not narrative text`);
}

function timestamp(value, path, now) {
  const parsed = Date.parse(value);
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(parsed) && parsed <= now, `${path} must be a past ISO timestamp`);
  return parsed;
}

export function statusPath(entry) {
  return `/templates/status/${entry.slug}`;
}

export function validateStatus(status, catalog, { now = Date.now() } = {}) {
  fields(status, ['version', 'updatedAt', 'entries'], 'status');
  requireValue(status.version === 1, 'version must be 1');
  const updatedAt = timestamp(status.updatedAt, 'status.updatedAt', now);
  requireValue(Array.isArray(status.entries), 'entries must be an array');
  const templates = new Map(catalog.templates.map(template => [template.slug, template]));
  const seen = new Set();
  for (const entry of status.entries) {
    fields(entry, ['slug', 'phase', 'updatedAt', 'summary', 'source', 'verification', 'lessons', 'limitations', 'blockers', 'journal'], 'entry');
    requireValue(templates.has(entry.slug), `unknown starter ${entry.slug}`);
    requireValue(!seen.has(entry.slug), `duplicate starter ${entry.slug}`);
    seen.add(entry.slug);
    const path = entry.slug;
    requireValue(Object.hasOwn(PHASE_LABELS, entry.phase), `${path}.phase is not supported`);
    const changedAt = timestamp(entry.updatedAt, `${path}.updatedAt`, now);
    requireValue(changedAt <= updatedAt, `${path}.updatedAt is newer than the status batch`);
    publicText(entry.summary, `${path}.summary`);
    const template = templates.get(path);
    for (const key of ['name', 'description', 'category', 'architecture']) publicText(template[key], `${path}.${key}`);
    for (const feature of template.features) publicText(feature, `${path}.feature`);
    fields(entry.source, ['state', 'verifiedAt', 'commitSha'], `${path}.source`);
    requireValue(['reserved', 'published'].includes(entry.source.state), `${path}.source.state must be reserved or published`);
    if (entry.source.state === 'published') {
      requireValue(timestamp(entry.source.verifiedAt, `${path}.source.verifiedAt`, now) <= changedAt, `${path}.source verification is newer than the status entry`);
      requireValue(/^[a-f0-9]{40}$/i.test(entry.source.commitSha), `${path}.source.commitSha must be a full public source SHA`);
    } else {
      requireValue(entry.source.verifiedAt === null && entry.source.commitSha === null, `${path}: reserved source must not carry publication proof`);
    }
    for (const key of ['lessons', 'limitations', 'blockers']) {
      requireValue(Array.isArray(entry[key]) && entry[key].length <= 20, `${path}.${key} must be an array of at most 20 public summaries`);
      for (const value of entry[key]) publicText(value, `${path}.${key}`);
    }
    requireValue(Array.isArray(entry.verification) && entry.verification.length <= 40, `${path}.verification must be an array of at most 40 checks`);
    for (const check of entry.verification) {
      fields(check, ['at', 'label', 'result', 'details'], `${path}.verification`);
      requireValue(timestamp(check.at, `${path}.verification.at`, now) <= changedAt, `${path}: check is newer than the status entry`);
      publicText(check.label, `${path}.verification.label`, 100);
      publicText(check.details, `${path}.verification.details`);
      requireValue(Object.hasOwn(RESULT_LABELS, check.result), `${path}: unsupported check result`);
    }
    if (entry.phase === 'local_verified') requireValue(entry.verification.some(check => check.result === 'passed'), `${path}: local_verified requires a recorded passed check`);
    if (entry.phase === 'live') {
      requireValue(template.status === 'published' && template.release && entry.source.state === 'published', `${path}: live phase needs a verified gallery release and published source`);
      requireValue(entry.source.commitSha === template.release.commitSha, `${path}: source and live release commits differ`);
    }
    if (template.status === 'published') requireValue(entry.phase === 'live', `${path}: published gallery entry must have a live status record`);
    requireValue(Array.isArray(entry.journal) && entry.journal.length > 0 && entry.journal.length <= 100, `${path}.journal must contain 1–100 updates`);
    let previous = 0;
    for (const event of entry.journal) {
      fields(event, ['at', 'phase', 'title', 'summary'], `${path}.journal`);
      const eventAt = timestamp(event.at, `${path}.journal.at`, now);
      requireValue(eventAt >= previous && eventAt <= changedAt, `${path}: journal must be chronological and not newer than the status entry`);
      previous = eventAt;
      requireValue(Object.hasOwn(PHASE_LABELS, event.phase), `${path}: journal phase is not supported`);
      publicText(event.title, `${path}.journal.title`, 100);
      publicText(event.summary, `${path}.journal.summary`);
    }
    requireValue(entry.journal.at(-1).phase === entry.phase, `${path}: latest journal phase must match current phase`);
  }
  requireValue(seen.size === templates.size, 'every catalog starter needs one status entry');
  return status;
}

export function publicStatus(status, catalog) {
  const templates = new Map(catalog.templates.map(template => [template.slug, template]));
  return { version: status.version, updatedAt: status.updatedAt, entries: status.entries.map(entry => {
    const template = templates.get(entry.slug);
    return {
      ...entry,
      name: template.name,
      description: template.description,
      category: template.category,
      intendedRuntimes: template.runtimes,
      intendedFeatures: template.features,
      intendedArchitecture: template.architecture,
      referencePath: statusPath(entry),
      sourceUrl: entry.source.state === 'published' ? sourceUrl(template) : null,
      buildGuideUrl: entry.source.state === 'published' ? buildGuideUrl(template) : null,
      demoUrl: entry.phase === 'live' ? template.release.demoUrl : null,
      inAppGuideUrl: entry.phase === 'live' ? template.release.buildUrl : null,
    };
  }) };
}

export function statusLlms(status, catalog) {
  const data = publicStatus(status, catalog);
  return `# What Framework starter build status\n\nPlans and build updates are not live releases. Only recorded published source and verified deployments receive source/demo links. Reported checks are not independent verification.\n\nUpdated: ${data.updatedAt}\n\n${data.entries.map(entry => {
    const learning = learningFor(entry.slug);
    return `## ${entry.name} — ${PHASE_LABELS[entry.phase]}\n\n${entry.summary}\n\n- Reference: https://whatfw.com${entry.referencePath}\n- Public source: ${entry.sourceUrl || 'Name reserved; public implementation unavailable'}\n- Live demo: ${entry.demoUrl || 'Not verified live'}\n- Checks: ${entry.verification.map(check => `${check.label}: ${RESULT_LABELS[check.result]} — ${check.details}`).join('; ') || 'No check results recorded'}\n- Lessons: ${entry.lessons.join('; ') || 'No implementation lessons recorded yet'}\n- Learning journal: ${learning ? learning.overview : 'No source-level journal recorded yet'}\n- Source paths: ${learning ? learning.sourceFiles.map(source => source.path).join(', ') : 'None recorded'}\n- Example topics: ${learning ? learning.examples.map(example => example.title).join('; ') : 'None recorded'}\n- Limitations: ${entry.limitations.join('; ') || 'None recorded; this does not imply none exist'}`;
  }).join('\n\n')}\n`;
}
