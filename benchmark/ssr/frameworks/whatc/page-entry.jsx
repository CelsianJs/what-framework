// what-server entry points for the ordinary page (page.jsx), as entry.jsx has
// them for the table page.
/* global __HYDRATABLE__ */
import { renderToString, renderToHydratableString, renderToStream } from 'what-server';
import { Page, buildProducts } from './page.jsx';

export { buildProducts };

const toString = __HYDRATABLE__ ? renderToHydratableString : renderToString;

const REVIEWS = [
  { id: 'r1', author: 'Ada', text: 'Exactly as pictured.' },
  { id: 'r2', author: 'Lin', text: 'Arrived quickly & well packed.' },
  { id: 'r3', author: 'Sam', text: 'Would buy again.' },
];

// The reviews never arrive in a string render, which shows the fallback; the
// stream waits for them, and they resolve in a microtask.
export function renderString(products, selected) {
  return toString(<Page products={products} selected={selected} loadReviews={() => new Promise(() => {})} />);
}

export function stream(products, selected, out) {
  renderToStream(<Page products={products} selected={selected} loadReviews={() => Promise.resolve(REVIEWS)} />).pipe(out);
}
