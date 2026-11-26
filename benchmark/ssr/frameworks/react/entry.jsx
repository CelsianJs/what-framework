// react-dom/server entry points. __HYDRATABLE__ is set per bundle by build.mjs:
// renderToStaticMarkup is React's non-hydratable string render, renderToString
// its hydratable one. renderToPipeableStream is always hydratable.
/* global __HYDRATABLE__ */
import { renderToStaticMarkup, renderToString, renderToPipeableStream } from 'react-dom/server';
import { App, AsyncApp } from './app.jsx';
import { Cards } from './cards.jsx';

const toString = __HYDRATABLE__ ? renderToString : renderToStaticMarkup;

export function renderString(rows, selected) {
  return toString(<App rows={rows} selected={selected} />);
}

function pipe(element, out) {
  const s = renderToPipeableStream(element, {
    onShellReady() { s.pipe(out); },
    onShellError(error) { out.destroy(error); },
    onError(error) { out.destroy(error); },
  });
}

export function stream(rows, selected, out) {
  pipe(<App rows={rows} selected={selected} />, out);
}

export function streamAsync(selected, load, out) {
  pipe(<AsyncApp selected={selected} load={load} />, out);
}

export function renderCards(cards) {
  return toString(<Cards cards={cards} />);
}
