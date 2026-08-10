// The incident store. SERVER ONLY: this module is never served over HTTP (see
// the allowlist in server.js), so the seed data and the mutation logic stay off
// the wire.
//
// Everything is derived from a fixed seed rather than Math.random(), because a
// demo whose feed reshuffles on every restart is impossible to reason about and
// impossible to assert on.

const SERVICES = [
  'checkout-api',
  'payments-worker',
  'edge-cdn',
  'search-index',
  'auth-gateway',
];

const SEVERITIES = ['critical', 'major', 'minor'];

const SYMPTOMS = [
  'p99 latency above SLO',
  'error rate spike on POST /orders',
  'queue depth growing without drain',
  'origin 5xx bursts behind the CDN',
  'replica lag past the failover threshold',
  'token refresh storm from one tenant',
  'disk pressure on the primary',
  'upstream timeout cascade',
];

/** Fixed reference point so relative times in the UI are stable within a run. */
export const BOOT_AT = Date.parse('2026-03-14T09:00:00.000Z');

let sequence = 1040;
const incidents = [];
const acks = new Map(); // id -> { id, by, at }

// 26 seeded incidents, newest first. The modulo walk is deliberate: it gives
// every service and severity several rows, so a filter always has something to
// find and the severity legend is never empty.
for (let i = 0; i < 26; i++) {
  const id = `INC-${sequence++}`;
  incidents.unshift({
    id,
    title: `${SERVICES[i % SERVICES.length]}: ${SYMPTOMS[i % SYMPTOMS.length]}`,
    service: SERVICES[i % SERVICES.length],
    severity: SEVERITIES[i % SEVERITIES.length],
    // Older rows further down the feed.
    openedAt: BOOT_AT - i * 7 * 60 * 1000,
    source: i % 3 === 0 ? 'prometheus' : 'synthetic-probe',
  });
}

export function listServices() {
  return [...SERVICES];
}

export function listSeverities() {
  return [...SEVERITIES];
}

/** One page of the feed, newest first. `cursor` is an offset into the list. */
export function listEvents(cursor = 0, limit = 8) {
  const start = Math.max(0, Number(cursor) || 0);
  const size = Math.min(Math.max(1, Number(limit) || 8), 25);
  const slice = incidents.slice(start, start + size);
  const next = start + size < incidents.length ? start + size : null;
  return { events: slice, nextCursor: next, total: incidents.length };
}

export function getIncident(id) {
  const incident = incidents.find((i) => i.id === id);
  if (!incident) return null;
  const ack = acks.get(id) || null;
  return {
    ...incident,
    ack,
    // A small synthetic timeline so the detail pane has something to render.
    timeline: [
      { at: incident.openedAt, label: `Detected by ${incident.source}` },
      { at: incident.openedAt + 60 * 1000, label: `Paged ${incident.service} on-call` },
      ...(ack ? [{ at: Date.parse(ack.at), label: `Acknowledged by ${ack.by}` }] : []),
    ],
  };
}

export function listAcks() {
  return [...acks.values()];
}

/**
 * Acknowledge an incident and return the AUTHORITATIVE ack list. The client
 * applies its own optimistic entry first and then reconciles onto whatever this
 * returns, so the server owning `by`/`at` is what makes the reconcile visible:
 * the optimistic row cannot know who acknowledged it.
 */
export function acknowledge(id, by = 'ops-bot') {
  if (!incidents.some((i) => i.id === id)) return null;
  if (!acks.has(id)) {
    acks.set(id, { id, by, at: new Date(BOOT_AT).toISOString() });
  }
  return listAcks();
}

export function createIncident({ title, service, severity }) {
  const incident = {
    id: `INC-${sequence++}`,
    title,
    service,
    severity,
    openedAt: BOOT_AT + incidents.length * 1000,
    source: 'console',
  };
  incidents.unshift(incident);
  return incident;
}

/**
 * The metrics roll-up behind the Suspense boundary on /health. Async on purpose:
 * a synchronous "resource" would resolve during the first render pass and prove
 * nothing about suspension.
 */
export async function summarize() {
  await new Promise((resolve) => setTimeout(resolve, 15));
  const bySeverity = {};
  for (const severity of SEVERITIES) {
    bySeverity[severity] = incidents.filter((i) => i.severity === severity).length;
  }
  return {
    total: incidents.length,
    acknowledged: acks.size,
    open: incidents.length - acks.size,
    bySeverity,
    services: SERVICES.length,
  };
}
