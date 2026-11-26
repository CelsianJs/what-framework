// @solidjs/web (2.0) server entry points. Hydratable or not is decided at
// compile time (@solidjs/babel-plugin `hydratable`), so build.mjs bundles this
// file twice; the runtime calls are the same in both bundles.
import { renderToString, renderToStream } from '@solidjs/web';
import { App, AsyncApp } from './app.jsx';
import { Cards } from './cards.jsx';

export function renderString(rows, selected) {
  return renderToString(() => <App rows={rows} selected={selected} />);
}

export function stream(rows, selected, out) {
  renderToStream(() => <App rows={rows} selected={selected} />).pipe(out);
}

export function streamAsync(selected, load, out) {
  renderToStream(() => <AsyncApp selected={selected} load={load} />).pipe(out);
}

export function renderCards(cards) {
  return renderToString(() => <Cards cards={cards} />);
}
