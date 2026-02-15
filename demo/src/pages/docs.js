import { h, useState, useMemo } from '@what/core';

const sections = [
  {
    id: 'quickstart',
    title: 'Quick Start',
    content: `Get started in seconds. No config required.`,
    code: `# Create a new project
npx create-what my-app
cd my-app
npm install
npm run dev

# Open http://localhost:5173`,
  },
  {
    id: 'signals',
    title: 'Signals & Reactivity',
    content: `Signals are the reactive primitive. A signal holds a value. Reading a signal inside an effect auto-tracks the dependency. Writing to a signal triggers only the effects that read it.`,
    code: `import { signal, computed, effect, batch } from 'what-framework';

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
    title: 'Components & JSX',
    content: `Components are plain functions that return JSX. The compiler transforms JSX into h() calls that produce VNodes, which are reconciled against the DOM through a single unified rendering path.`,
    code: `import { mount, useState, useEffect } from 'what-framework';

// Simple component
function Greeting({ name }) {
  return <p>Hello, {name}</p>;
}

// Stateful component with signals
function Counter({ initial = 0 }) {
  const [count, setCount] = useState(initial);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
}

// Component with effects
function Clock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id); // cleanup
  }, []);

  return <p>{time.toLocaleTimeString()}</p>;
}

// Compose them
function App() {
  return (
    <div>
      <Greeting name="What" />
      <Counter initial={5} />
      <Clock />
    </div>
  );
}

mount(<App />, '#app');`,
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
  useContext,     // read from context
  createContext,  // create context with Provider
} from 'what-framework';

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
    id: 'jsx-features',
    title: 'JSX Features',
    content: `The What compiler extends JSX with powerful directives. bind:value compiles to value + onInput props. Event modifiers compile to normal props. No signal auto-wrapping — expressions are passed through as-is.`,
    code: `import { useState } from 'what-framework';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);

  return (
    <form onSubmit.prevent={handleLogin}>
      {/* bind:value compiles to value={email} onInput={...} */}
      <input bind:value={email} placeholder="Email" />
      <input bind:value={password} type="password" />
      <input bind:checked={remember} type="checkbox" />

      {/* Event modifiers output as normal props */}
      <button onClick.once={trackFirstClick}>Track</button>
      <div onScroll.throttle={handleScroll}>...</div>
      <input onKeydown.enter={submit} />

      {/* Conditional rendering */}
      <div w:if={email}>Welcome, {email}</div>
      <div w:else>Please enter your email</div>

      {/* List rendering */}
      <ul>
        <li w:for={item in items} w:key={item.id}>
          {item.name}
        </li>
      </ul>

      <button type="submit">Log In</button>
    </form>
  );
}

// The compiler pipeline:
// JSX -> babel plugin -> h() calls -> VNode -> reconciler -> DOM
// No signal auto-wrapping, no dual rendering paths`,
  },
  {
    id: 'routing',
    title: 'Routing',
    content: `File-based routing with dynamic params. Or define routes programmatically. Nested layouts, guards, and prefetching built in.`,
    code: `import { Router, Link, navigate, route, defineRoutes }
  from 'what-framework/router';

// Programmatic routes
const routes = defineRoutes({
  '/':           Home,
  '/about':      About,
  '/users/:id':  UserProfile,
  '/blog/*':     BlogCatchAll,
  '/admin':      { component: Admin, layout: AdminLayout },
});

// Or file-based (automatic):
// src/pages/index.jsx       -> /
// src/pages/about.jsx       -> /about
// src/pages/users/[id].jsx  -> /users/:id
// src/pages/blog/[...slug].jsx -> /blog/*

// Router component
function App() {
  return <Router routes={routes} fallback={<NotFound />} />;
}

// Link component (client-side navigation)
<Link href="/about">About Us</Link>

// Programmatic navigation
navigate('/users/123');
navigate('/login', { replace: true });

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
    content: `Ship zero JavaScript by default. The Island component is now in core. Use JSX directives to control when each island hydrates.`,
    code: `// The Island component is built into core
import { Island } from 'what-framework';

import { Search } from './islands/Search';
import { Cart } from './islands/Cart';
import { Feed } from './islands/Feed';

function ProductPage({ products }) {
  return (
    <div>
      <Nav />                          {/* Static — no JS */}

      <Search                          {/* Hydrates when idle */}
        client:idle
        placeholder="Search..."
      />

      <Feed                            {/* Hydrates on scroll */}
        client:visible
        category="new"
        items={products}
      />

      <Cart client:load />             {/* Hydrates immediately */}

      <Footer />                       {/* Static — no JS */}
    </div>
  );
}

// Hydration directives:
// client:load    - Hydrate immediately
// client:idle    - requestIdleCallback
// client:visible - IntersectionObserver
// client:media="(max-width: 768px)" - Media query
// (no directive) - Static, never hydrate`,
  },
  {
    id: 'ssr',
    title: 'SSR & Static Generation',
    content: `Render pages on the server or at build time. Per-page control: static, server, client, or hybrid.`,
    code: `import { renderToString, renderToStream, definePage }
  from 'what-framework/server';

// Render to string (SSR)
const html = renderToString(<App data={data} />);

// Streaming SSR
for await (const chunk of renderToStream(<App data={data} />)) {
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
function Header({ title }) {
  // This component never ships JS to the client
  return <header><h1>{title}</h1></header>;
}`,
  },
  {
    id: 'config',
    title: 'Configuration',
    content: `Zero config to start. One file when you need control. Vite dev server runs on port 5173.`,
    code: `// what.config.js
export default {
  // Rendering mode (default for all pages)
  mode: 'hybrid',  // 'static' | 'server' | 'client' | 'hybrid'

  // File-based routing
  pagesDir: 'src/pages',

  // Build output
  outDir: 'dist',

  // Enable islands architecture (Island component is in core)
  islands: true,

  // JSX compiler options
  compiler: {
    // Compiler outputs h() calls through VNode reconciler
    // bind: directives compile to value + onInput props
    // Event modifiers compile to normal props
    bindings: true,
    eventModifiers: true,
  },

  // Dev server (Vite)
  port: 5173,
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
# -> Runs on port 5173

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

  return h('div', { class: 'section' },
    h('div', { class: 'features-header' },
      h('p', { class: 'features-label' }, 'Learn'),
      h('h1', { class: 'features-title' }, 'Documentation'),
      h('p', { class: 'features-subtitle' },
        'Everything you need to build with What.',
      ),
    ),

    h('div', { style: 'display: flex; gap: 3rem; margin-top: 3rem;' },
      // Sidebar
      h('nav', {
        style: {
          minWidth: '200px',
          position: 'sticky',
          top: '6rem',
          alignSelf: 'flex-start',
        },
      },
        ...sections.map(s =>
          h('a', {
            href: `#${s.id}`,
            class: active === s.id ? 'nav-link active' : 'nav-link',
            style: {
              display: 'block',
              padding: '0.5rem 1rem',
              marginBottom: '0.25rem',
              borderRadius: 'var(--radius-md)',
              textDecoration: 'none',
              fontSize: 'var(--text-sm)',
              color: active === s.id ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              background: active === s.id ? 'var(--color-accent-subtle)' : 'transparent',
              fontWeight: active === s.id ? '600' : '400',
              transition: 'all 0.15s ease',
            },
            onClick: (e) => { e.preventDefault(); setActive(s.id); },
          }, s.title)
        ),
      ),

      // Content
      h('div', { style: 'flex: 1; min-width: 0;' },
        h('div', { class: 'demo-card animate-fade-up', key: section.id },
          h('h2', { style: { marginBottom: '0.5rem' } }, section.title),
          h('p', { class: 'text-secondary', style: { marginBottom: '1.5rem' } }, section.content),
          h('div', { class: 'code-block', style: { margin: 0, maxWidth: 'none' } },
            h('div', { class: 'code-header' },
              h('div', { class: 'code-dots' },
                h('span', { class: 'code-dot' }),
                h('span', { class: 'code-dot' }),
                h('span', { class: 'code-dot' }),
              ),
              h('span', { class: 'code-filename' },
                section.id === 'quickstart' || section.id === 'deploy'
                  ? 'terminal'
                  : section.id === 'config'
                    ? 'what.config.js'
                    : section.id + '.jsx'
              ),
            ),
            h('div', { class: 'code-content' },
              h('pre', null, h('code', null, section.code)),
            ),
          ),
        ),
      ),
    ),
  );
}
