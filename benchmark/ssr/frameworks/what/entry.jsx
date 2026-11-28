// what-server entry points. __HYDRATABLE__ is set per bundle by build.mjs.
// renderToStream writes the hydration markers renderToHydratableString writes.
//
// Imported from 'what-server', the package a Node server installs. Its Node
// entry installs the AsyncLocalStorage render context, which the measured
// configuration includes.
/* global __HYDRATABLE__ */
import { renderToString, renderToHydratableString, renderToStream } from 'what-server';
import { App, AsyncApp } from './app.jsx';
import { Cards } from './cards.jsx';

const toString = __HYDRATABLE__ ? renderToHydratableString : renderToString;

export function renderString(rows, selected) {
  return toString(<App rows={rows} selected={selected} />);
}

// renderToStream(...).pipe() writes the shell, then each streamed boundary,
// into a Node writable with backpressure and ends it, like Solid's pipe().
export function stream(rows, selected, out) {
  renderToStream(<App rows={rows} selected={selected} />).pipe(out);
}

export function streamAsync(selected, load, out) {
  renderToStream(<AsyncApp selected={selected} load={load} />).pipe(out);
}

export function renderCards(cards) {
  return toString(<Cards cards={cards} />);
}
