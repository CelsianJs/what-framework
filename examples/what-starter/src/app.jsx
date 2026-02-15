// App — entry point
// Sets up routing with a shared layout wrapper.

import { mount } from 'what-framework';
import { Router, defineRoutes } from 'what-router';

import { Layout } from './components/Layout.jsx';
import { Home } from './pages/Home.jsx';
import { AddContact } from './pages/AddContact.jsx';
import { About } from './pages/About.jsx';

// Define routes — keys are URL paths, values are components
const routes = defineRoutes({
  '/': Home,
  '/add': AddContact,
  '/about': About,
});

function NotFound() {
  return (
    <div style="text-align: center; padding: 60px 20px;">
      <h1 style="font-size: 48px; margin-bottom: 8px;">404</h1>
      <p style="color: var(--text-muted);">Page not found</p>
    </div>
  );
}

// App wraps Router in a Layout so all pages share the same header/nav
function App() {
  return (
    <Layout>
      <Router routes={routes} fallback={NotFound} />
    </Layout>
  );
}

mount(<App />, '#app');
