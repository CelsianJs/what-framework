// What every page's server loader does: read the visitor from the cookie, and
// fill the query cache of this request with the entries the page reads, from
// the database, so the server render and the hydrating browser have them
// without a request. A signed-out visitor gets no data; the org shell sends
// them to sign in.

import { prefetchQuery } from 'what-framework/data';
import { readSession } from './session.js';

export async function loadPage({ request }, entries = () => []) {
  const session = readSession(request.headers.get('cookie'));
  if (session === null) return { session };
  const { db, latency } = await import('./db.js');
  await latency(40);
  await Promise.all(entries(db).map(([key, value]) => prefetchQuery(key, () => value)));
  return { session };
}
