// What Framework Demo App
import { mount } from 'what-framework';
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
  return (
    <div class="not-found">
      <h1>404</h1>
      <p>This page doesn't exist.</p>
      <Link href="/" class="btn btn-primary">Back to home</Link>
    </div>
  );
}

function App() {
  return <Router routes={routes} fallback={NotFound} />;
}

mount(<App />, '#app');
