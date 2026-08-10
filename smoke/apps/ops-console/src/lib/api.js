// The console's HTTP client. Client-safe: served to the browser, imported by
// the hydrated page and by the lazily loaded detail panel.

export const PAGE_SIZE = 8;

async function json(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    // The message is surfaced in the live region, so keep it short and human.
    throw new Error(`${res.status} ${res.statusText || 'request failed'}`);
  }
  return res.json();
}

/** One page of the event feed. `cursor` is the offset returned as `nextCursor`. */
export function fetchEvents(cursor = 0, limit = PAGE_SIZE, signal) {
  return json(`/api/events?cursor=${cursor}&limit=${limit}`, { signal });
}

export function fetchIncident(id, signal) {
  return json(`/api/incidents/${encodeURIComponent(id)}`, { signal });
}

/** The acknowledgements the server already knows about, read once on boot. */
export function fetchAcks(signal) {
  return json('/api/acks', { signal });
}

/**
 * Acknowledge. Returns the AUTHORITATIVE ack list, which is what the optimistic
 * update reconciles onto: the client cannot invent `by`/`at`, so the reconcile
 * is visible in the row rather than being a no-op that looks like success.
 */
export function postAck(id) {
  return json(`/api/incidents/${encodeURIComponent(id)}/ack`, { method: 'POST' });
}

export function postIncident(body) {
  return json('/api/incidents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
