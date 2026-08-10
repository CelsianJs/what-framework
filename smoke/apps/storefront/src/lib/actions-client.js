// Client-side action caller.
//
// Server action modules import the database, so they are never served to the
// browser. The browser does not need them: an action is addressed by id over
// the served-action protocol (POST /__what_action with the X-What-Action
// header), which is exactly what the framework's own action() client does.

/** The double-submit CSRF token the server embedded in the page. */
export function csrfToken() {
  const meta = document.querySelector('meta[name="what-csrf-token"]');
  if (meta) return meta.getAttribute('content') ?? '';
  const match = document.cookie.match(/(?:^|;\s*)what-csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export async function callAction(id, args = {}) {
  const token = csrfToken();
  const headers = { 'content-type': 'application/json', 'x-what-action': id };
  if (token) headers['x-csrf-token'] = token;

  const res = await fetch('/__what_action', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify({ args: [args] }),
  });

  // On success the body IS the action's return value. On failure it is
  // { message }, and a thrown action deliberately reports a generic
  // "Action failed" so internals never reach the client.
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.message || `action failed (${res.status})`);
  return payload;
}
