// Server entry (vite build --ssr): the routes createRequestHandler serves.
// Each is a page of the file router with its own loader; every one renders
// App, whose FileRouter picks the page for the request's URL and puts it in
// its layouts. The JSON API and the action live in this bundle too, so they
// share the loaders' database.

import { routes as pages } from 'virtual:what-routes/server';
import App from './App.jsx';
import './actions.js';

export { api, apiStats } from './api.js';

export const routes = pages.map((r) => ({ path: r.path, component: App, loader: r.loader, mode: 'server', page: { mode: 'server' } }));
