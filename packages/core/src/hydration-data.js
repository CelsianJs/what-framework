// Client hydration payload reader. The server emits a single
// <script id="__what_data" type="application/json">{loaderData,resources,islandStores}</script>
// (via serializeState — XSS-safe, valid JSON). This module is the single source
// of truth the client uses for useLoaderData() and createResource() seeding.

let _cache;

export function __readHydrationData() {
  if (_cache !== undefined) return _cache;
  if (typeof document === 'undefined') return (_cache = null);
  const el = document.getElementById('__what_data');
  if (!el) return (_cache = null);
  try {
    _cache = JSON.parse(el.textContent);
  } catch {
    _cache = null;
  }
  return _cache;
}

/** Test/HMR hook: drop the cached payload so the next read re-parses. */
export function __resetHydrationData() {
  _cache = undefined;
}

export function getLoaderData() {
  const data = __readHydrationData();
  return data ? data.loaderData : undefined;
}

export function getResource(key) {
  const data = __readHydrationData();
  return data && data.resources ? data.resources[key] : undefined;
}
