import { h, useState, useMemo } from '@what/core';

const sections = [
  {
    id: 'quickstart',
    title: 'Quick Start',
    content: `# Quick Start

\`\`\`bash
npm create what@latest my-app
cd my-app
npm install
npm run dev
\`\`\`

That's it. Open http://localhost:3000 and start building.`,
    code: `// src/app.js
import { h, mount, useState } from 'what';

function App() {
  const [name, setName] = useState('World');

  return h('div', null,
    h('h1', null, 'Hello, ', name, '!'),
    h('input', {
      value: name,
      onInput: (e) => setName(e.target.value),
    }),
  );
}

mount(h(App), '#app');`,
  },
  {
    id: 'signals',
    title: 'Signals & Reactivity',
    content: `Signals are the reactive primitive. A signal holds a value. Reading a signal inside an effect auto-tracks the dependency. Writing to a signal triggers only the effects that read it.`,
    code: `import { signal, computed, effect, batch } from 'what';

// Create a signal
const count = signal(0);

// Read it
console.log(count());  // 0

// Write it
count.set(1);
count.set(c => c + 1); // updater function

// Computed: derived value, lazy
const doubled = computed(() => count() * 2);

// Effect: runs when deps change
const dispose = effect(() => {
  console.log('Count is:', count());
});

// Batch: group writes, effects run once
batch(() => {
  count.set(10);
  count.set(20); // effect only runs once with 20
});

// Cleanup
dispose();`,
  },
  {
    id: 'components',
    title: 'Components',
    content: `Components are plain functions that return VNodes. Use h() to create elements. Props are the first argument. Children come after.`,
    code: `import { h, mount, useState, useEffect, useRef } from 'what';

// Simple component
function Greeting({ name }) {
  return h('p', null, 'Hello, ', name);
}

// Stateful component
function Counter({ initial = 0 }) {
  const [count, setCount] = useState(initial);

  return h('div', null,
    h('p', null, 'Count: ', count),
    h('button', { onClick: () => setCount(c => c + 1) }, '+'),
  );
}

// Component with effects
function Clock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id); // cleanup
  }, []);

  return h('p', null, time.toLocaleTimeString());
}

// Compose them
function App() {
  return h('div', null,
    h(Greeting, { name: 'What' }),
    h(Counter, { initial: 5 }),
    h(Clock),
  );
}

mount(h(App), '#app');`,
  },
  {
    id: 'hooks',
    title: 'Hooks API',
    content: `All React hooks you know, backed by signals for surgical updates.`,
    code: `import {
  useState,       // [value, setter] — reactive state
  useSignal,      // raw signal — read with sig(), write with sig.set()
  useComputed,    // derived value — only recomputes when deps change
  useEffect,      // side effects with cleanup
  useMemo,        // memoized value
  useCallback,    // stable function reference
  useRef,         // mutable ref (no re-render)
  useReducer,     // state with reducer function
  useContext,      // read from context
  createContext,   // create context with Provider
} from 'what';

// useState — familiar React API
const [count, setCount] = useState(0);
setCount(c => c + 1);

// useSignal — more direct, less overhead
const count = useSignal(0);
count();        // read
count.set(5);   // write

// useEffect — with dependency array
useEffect(() => {
  document.title = \`Count: \${count}\`;
  return () => { /* cleanup */ };
}, [count]);

// useReducer — complex state logic
const [state, dispatch] = useReducer(
  (state, action) => {
    switch (action.type) {
      case 'inc': return { n: state.n + 1 };
      case 'dec': return { n: state.n - 1 };
    }
  },
  { n: 0 }
);
dispatch({ type: 'inc' });`,
  },
  {
    id: 'routing',
    title: 'Routing',
    content: `File-based routing with dynamic params. Or define routes programmatically. Nested layouts, guards, and prefetching built in.`,
    code: `import { Router, Link, navigate, route, defineRoutes, guard } from 'what/router';

// Programmatic routes
const routes = defineRoutes({
  '/':           Home,
  '/about':      About,
  '/users/:id':  UserProfile,
  '/blog/*':     BlogCatchAll,
  '/admin':      { component: Admin, layout: AdminLayout },
});

// Or file-based (automatic):
// src/pages/index.js       -> /
// src/pages/about.js       -> /about
// src/pages/users/[id].js  -> /users/:id
// src/pages/blog/[...slug].js -> /blog/*

// Router component
function App() {
  return h(Router, { routes, fallback: NotFound });
}

// Link component (client-side navigation)
h(Link, { href: '/about' }, 'About Us')

// Programmatic navigation
navigate('/users/123');
navigate('/login', { replace: true });

// Route guards
const AdminPage = guard(
  () => isLoggedIn(),  // check function
  '/login'             // redirect on fail
)(AdminComponent);

// Read current route
effect(() => {
  console.log(route.path);    // '/users/123'
  console.log(route.params);  // { id: '123' }
  console.log(route.query);   // { tab: 'posts' }
});`,
  },
  {
    id: 'islands',
    title: 'Islands',
    content: `Ship zero JavaScript by default. Only hydrate the interactive parts of the page. Each island loads independently with its own strategy.`,
    code: `import { island, Island, autoIslands } from 'what/server';

// Register islands with hydration strategy
island('search', () => import('./islands/search.js'), { mode: 'idle' });
island('cart',   () => import('./islands/cart.js'),   { mode: 'action' });
island('feed',   () => import('./islands/feed.js'),   { mode: 'visible' });

// In your page:
function ProductPage() {
  return h('div', null,
    h(Nav),                          // Static - no JS
    h(Island, { name: 'search' }),   // Hydrates on idle
    h(Island, {                      // Hydrates on scroll
      name: 'feed',
      props: { category: 'new' },
    }),
    h(Island, { name: 'cart' }),     // Hydrates on click
    h(Footer),                       // Static - no JS
  );
}

// Modes:
// 'load'    - Hydrate immediately
// 'idle'    - requestIdleCallback
// 'visible' - IntersectionObserver
// 'action'  - First click/focus/hover
// 'media'   - Media query match
// 'static'  - Never hydrate (pure HTML)`,
  },
  {
    id: 'ssr',
    title: 'SSR & Static Generation',
    content: `Render pages on the server or at build time. Per-page control: static, server, client, or hybrid.`,
    code: `import { renderToString, renderToStream, definePage, server } from 'what/server';

// Render to string (SSR)
const html = renderToString(h(App, { data }));

// Streaming SSR
for await (const chunk of renderToStream(h(App, { data }))) {
  response.write(chunk);
}

// Per-page rendering mode
export default definePage({
  mode: 'static',   // Pre-render at build time
  component: HomePage,
  title: 'Home',
});

export default definePage({
  mode: 'server',   // Render on every request
  component: DashboardPage,
});

export default definePage({
  mode: 'hybrid',   // Static shell + islands
  component: ProductPage,
  islands: ['search', 'cart'],
});

// Server components — zero client JS
const Header = server(function Header({ title }) {
  return h('header', null, h('h1', null, title));
});`,
  },
  {
    id: 'config',
    title: 'Configuration',
    content: `Zero config to start. One file when you need control.`,
    code: `// what.config.js
export default {
  // Rendering mode (default for all pages)
  mode: 'hybrid',  // 'static' | 'server' | 'client' | 'hybrid'

  // File-based routing
  pagesDir: 'src/pages',

  // Build output
  outDir: 'dist',

  // Enable islands architecture
  islands: true,

  // Dev server
  port: 3000,
  host: 'localhost',
};`,
  },
  {
    id: 'deploy',
    title: 'Deployment',
    content: `No Docker needed. Build produces static files or a tiny Node server. Deploy anywhere.`,
    code: `# Static site (Netlify, Vercel, Cloudflare Pages)
what generate
# -> dist/ contains pure HTML/CSS/JS

# Node server (any host)
what build
node dist/server.js
# -> Runs on port 3000

# Output structure:
# dist/
#   index.html          (pre-rendered)
#   about/index.html    (pre-rendered)
#   @what/core.js       (runtime, ~3kB gzip)
#   assets/             (CSS, images)
#   islands/            (island JS, code-split)`,
  },
];

export function Docs() {
  const [active, setActive] = useState('quickstart');

  const section = useMemo(
    () => sections.find(s => s.id === active),
    [active]
  );

  return h('div', null,
    h('h1', null, 'Documentation'),
    h('p', { style: 'color:var(--muted);margin-bottom:2rem' },
      'Everything you need to build with What.',
    ),

    h('div', { style: 'display:flex;gap:2rem' },
      // Sidebar
      h('nav', { style: 'min-width:180px' },
        ...sections.map(s =>
          h('a', {
            href: `#${s.id}`,
            style: `display:block;padding:0.4rem 0.75rem;margin-bottom:0.25rem;border-radius:6px;text-decoration:none;font-size:0.9rem;color:${active === s.id ? 'var(--accent)' : 'var(--muted)'};background:${active === s.id ? 'var(--accent-light)' : 'transparent'};font-weight:${active === s.id ? '600' : '400'}`,
            onClick: (e) => { e.preventDefault(); setActive(s.id); },
          }, s.title)
        ),
      ),

      // Content
      h('div', { style: 'flex:1;min-width:0' },
        h('h2', null, section.title),
        h('p', { style: 'color:var(--muted);margin-bottom:1rem' }, section.content),
        h('pre', null, h('code', null, section.code)),
      ),
    ),
  );
}

