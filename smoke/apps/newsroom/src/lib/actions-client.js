// Calls a server action from the browser by id, over the action protocol
// (POST /__what_action with X-What-Action), the way what-server's own action
// client does. The action modules import the database, so the browser never
// loads them.

export async function callAction(id, args) {
  const headers = { 'content-type': 'application/json', 'x-what-action': id };
  // Cached pages carry no token in a <meta>; the double-submit cookie has it.
  const token = /(?:^|;\s*)what-csrf=([^;]+)/.exec(document.cookie)?.[1];
  if (token) headers['x-csrf-token'] = decodeURIComponent(token);
  const res = await fetch('/__what_action', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify({ args: [args] }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.message || `action failed (${res.status})`);
  return payload;
}
