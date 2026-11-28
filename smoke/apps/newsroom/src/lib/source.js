// Where the front page's queries read from. The page module runs on both
// sides, so its fetchers go through this: in the browser over HTTP, on the
// server straight to the backing services (server.js installs that source
// before the first render). The browser only fetches when the page did not
// carry the value, which a hydrated front page always does.

let impl = {
  mostRead: (page, signal) => fetch(`/api/most-read?page=${page}`, { signal }).then((r) => r.json()),
  markets: (page, signal) => fetch(`/api/markets?page=${page}`, { signal }).then((r) => r.json()),
};

export const source = {
  mostRead: (page, signal) => impl.mostRead(page, signal),
  markets: (page, signal) => impl.markets(page, signal),
};

export function installSource(next) {
  impl = next;
}
