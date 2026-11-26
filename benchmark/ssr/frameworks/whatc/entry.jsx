// what-server entry points for the compiled page. The same calls as the `what`
// entry: compiled JSX is a node every what-server renderer accepts.
/* global __HYDRATABLE__ */
import { renderToString, renderToHydratableString, renderToStream } from 'what-server';
import { App, AsyncApp } from './app.jsx';
import { Cards } from './cards.jsx';

const toString = __HYDRATABLE__ ? renderToHydratableString : renderToString;

export function renderString(rows, selected) {
  return toString(<App rows={rows} selected={selected} />);
}

export function stream(rows, selected, out) {
  renderToStream(<App rows={rows} selected={selected} />).pipe(out);
}

export function streamAsync(selected, load, out) {
  renderToStream(<AsyncApp selected={selected} load={load} />).pipe(out);
}

export function renderCards(cards) {
  return toString(<Cards cards={cards} />);
}
