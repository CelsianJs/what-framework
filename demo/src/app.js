// What Framework Demo App
import { h, mount, signal } from 'what-framework';
import { Router, Link, defineRoutes } from 'what-framework/router';
import { Layout } from './layouts/main.js';
import { Home } from './pages/home.js';
import { Docs } from './pages/docs.js';
import { Demos } from './pages/demos.js';
import { Bench } from './pages/bench.js';
import { Islands } from './pages/islands.js';

const routes = defineRoutes({
  '/': { component: Home, layout: Layout },
  '/docs': { component: Docs, layout: Layout },
  '/demos': { component: Demos, layout: Layout },
  '/bench': { component: Bench, layout: Layout },
  '/islands': { component: Islands, layout: Layout },
});

function NotFound() {
  return h('div', { class: 'not-found' },
    h('h1', null, '404'),
    h('p', null, 'This page doesn\'t exist.'),
    h(Link, { href: '/', class: 'btn btn-primary' }, 'Back to home'),
  );
}

function App() {
  return h(Router, { routes, fallback: NotFound });
}

mount(h(App), '#app');
