#!/usr/bin/env node

/**
 * What Framework MCP Server
 *
 * Provides documentation and assistance for the What Framework.
 * Exposes tools for getting API reference, examples, and guidance.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Framework documentation content
const DOCS = {
  overview: `
What Framework is a lightweight, signals-based web framework.

Key features:
- Signals: Fine-grained reactivity without virtual DOM diffing
- Islands: Zero JS by default, hydrate components on demand
- ~4kB gzipped: Tiny bundle size
- React-compatible hooks: useState, useEffect, useMemo backed by signals
- File-based routing: Drop files in pages/, get routes
- SSR/SSG/Hybrid: Choose rendering mode per page
- TypeScript: Full type definitions included
`,

  signals: `
## Signals

Signals are reactive primitives that hold values and notify subscribers when changed.

\`\`\`js
import { signal, computed, effect, batch, untrack } from 'what';

// Create a signal
const count = signal(0);

// Read value
count();           // 0

// Write value
count.set(5);      // set to 5
count.set(c => c + 1);  // increment

// Read without tracking
count.peek();

// Subscribe to changes
const unsub = count.subscribe(value => console.log(value));

// Computed (derived) signals
const doubled = computed(() => count() * 2);

// Effects (side effects)
const dispose = effect(() => {
  console.log('Count is:', count());
});

// Batch multiple updates
batch(() => {
  a.set(1);
  b.set(2);
  // Effects run once at the end
});

// Read without subscribing in an effect
effect(() => {
  const val = untrack(() => someSignal());
});
\`\`\`
`,

  components: `
## Components

Components are functions that return VNodes.

\`\`\`js
import { h, mount, signal } from 'what';

// Simple component
function Greeting({ name }) {
  return h('div', null, 'Hello, ', name);
}

// Stateful component with signals
function Counter() {
  const count = signal(0);

  return h('div', null,
    h('p', null, 'Count: ', () => count()),
    h('button', { onClick: () => count.set(c => c + 1) }, '+'),
  );
}

// Mount to DOM
mount(h(Counter), '#app');
\`\`\`

### h() Function

\`\`\`js
h(tag, props, ...children)
h('div', { class: 'box' }, 'Hello')
h('input', { type: 'text', onInput: e => {} })
h(MyComponent, { name: 'World' })
\`\`\`

Props handling:
- \`class\` / \`className\` → el.className
- \`style\` (object or string) → el.style
- \`on*\` → event listeners (onClick → click)
- \`ref\` → ref.current = el
- \`key\` → list reconciliation
`,

  hooks: `
## Hooks

React-compatible hooks backed by signals.

\`\`\`js
import { useState, useEffect, useMemo, useCallback, useRef, useReducer, createContext, useContext } from 'what';

// State
const [count, setCount] = useState(0);
setCount(5);
setCount(c => c + 1);

// Effect
useEffect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}, [dependency]);

// Memo
const expensive = useMemo(() => compute(a, b), [a, b]);

// Callback
const handler = useCallback(e => doStuff(e), [dep]);

// Ref
const ref = useRef(null);
h('input', { ref }); // ref.current = <input>

// Reducer
const [state, dispatch] = useReducer(reducer, initialState);

// Context
const ThemeCtx = createContext('light');
h(ThemeCtx.Provider, { value: 'dark' }, children);
const theme = useContext(ThemeCtx);
\`\`\`
`,

  islands: `
## Islands Architecture

Islands let you send zero JavaScript by default, hydrating only interactive parts.

\`\`\`js
import { island, Island } from 'what/server';

// Register an island with hydration strategy
island('cart', () => import('./islands/cart.js'), {
  mode: 'action',  // Hydrate on first interaction
});

// Use in a page
function Page() {
  return h('div', null,
    h('nav', null, 'Static nav — no JS'),
    h(Island, { name: 'cart' }),  // Interactive island
    h('footer', null, 'Static footer — no JS'),
  );
}
\`\`\`

### Hydration Modes

- \`'idle'\`: Hydrate when browser is idle
- \`'visible'\`: Hydrate when visible (IntersectionObserver)
- \`'action'\`: Hydrate on first click/focus
- \`'media'\`: Hydrate when media query matches
- \`'load'\`: Hydrate immediately
- \`'static'\`: Never hydrate (server only)
`,

  routing: `
## Routing

File-based and programmatic routing.

\`\`\`js
import { Router, Link, navigate, route } from 'what/router';

// Declare routes
h(Router, {
  routes: [
    { path: '/', component: Home },
    { path: '/about', component: About },
    { path: '/users/:id', component: User },
    { path: '/blog/*', component: BlogLayout },
  ],
  fallback: h(NotFound),
});

// Navigation
h(Link, { href: '/about' }, 'About');
navigate('/dashboard');
navigate('/login', { replace: true });

// Reactive route state
route.path();    // current path
route.params();  // { id: '123' }
route.query();   // { page: '1' }
\`\`\`

### Nested Layouts

\`\`\`js
{
  path: '/dashboard',
  component: DashboardLayout,
  children: [
    { path: '', component: DashboardHome },
    { path: 'settings', component: Settings },
  ],
}
\`\`\`
`,

  forms: `
## Form Utilities

React Hook Form-like API.

\`\`\`js
import { useForm, rules, simpleResolver } from 'what';

function SignupForm() {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { email: '', password: '' },
    resolver: simpleResolver({
      email: [rules.required(), rules.email()],
      password: [rules.required(), rules.minLength(8)],
    }),
  });

  return h('form', { onSubmit: handleSubmit(onSubmit) },
    h('input', { ...register('email') }),
    h('input', { ...register('password'), type: 'password' }),
    h('button', { type: 'submit' }, 'Submit'),
  );
}
\`\`\`

### Validation Rules

\`\`\`js
rules.required(message?)
rules.minLength(min, message?)
rules.maxLength(max, message?)
rules.min(min, message?)
rules.max(max, message?)
rules.pattern(regex, message?)
rules.email(message?)
rules.url(message?)
rules.match(field, message?)
rules.custom(validator)
\`\`\`
`,

  dataFetching: `
## Data Fetching

SWR-like hooks for data fetching.

\`\`\`js
import { useSWR, useQuery, useInfiniteQuery } from 'what';

// useSWR
const { data, error, isLoading, mutate, revalidate } = useSWR(
  'user-data',
  (key) => fetch('/api/user').then(r => r.json()),
  { revalidateOnFocus: true }
);

// useQuery (TanStack Query-like)
const { data, error, isLoading, refetch } = useQuery({
  queryKey: ['todos', userId],
  queryFn: ({ queryKey }) => fetchTodos(queryKey[1]),
  staleTime: 5000,
  cacheTime: 5 * 60 * 1000,
});

// useInfiniteQuery
const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
  queryKey: ['posts'],
  queryFn: ({ pageParam }) => fetchPosts(pageParam),
  getNextPageParam: (lastPage) => lastPage.nextCursor,
  initialPageParam: 0,
});
\`\`\`

### Cache Management

\`\`\`js
import { invalidateQueries, prefetchQuery, setQueryData, clearCache } from 'what';

invalidateQueries('user-data');
prefetchQuery('user', fetcher);
setQueryData('user', { name: 'John' });
clearCache();
\`\`\`
`,

  animation: `
## Animation

Physics-based springs and tweens.

\`\`\`js
import { spring, tween, easings, useGesture } from 'what';

// Spring animation
const x = spring(0, { stiffness: 100, damping: 10 });
x.set(100);      // Animate to 100
x.current();     // Current value
x.snap(50);      // Immediately set to 50

// Tween animation
const t = tween(0, 100, {
  duration: 300,
  easing: easings.easeOutQuad,
});

// Gesture handling
useGesture(ref, {
  onDrag: ({ deltaX, deltaY, velocity }) => {},
  onSwipe: ({ direction }) => {},
  onTap: ({ x, y }) => {},
  onPinch: ({ scale }) => {},
});
\`\`\`
`,

  accessibility: `
## Accessibility

Built-in accessibility utilities.

\`\`\`js
import {
  useFocusTrap, FocusTrap,
  announce, announceAssertive,
  SkipLink,
  useAriaExpanded,
  useRovingTabIndex,
  VisuallyHidden,
  Keys, onKey,
} from 'what';

// Focus trap for modals
const trap = useFocusTrap(modalRef);
trap.activate();
trap.deactivate();

// Or as component
h(FocusTrap, { active: isOpen }, h(Modal));

// Screen reader announcements
announce('Item added to cart');
announceAssertive('Error: Form invalid');

// Skip navigation
h(SkipLink, { href: '#main' }, 'Skip to content');

// ARIA helpers
const { expanded, buttonProps, panelProps } = useAriaExpanded(false);

// Keyboard navigation
const { getItemProps } = useRovingTabIndex(items.length);

// Key handling
h('input', { onKeyDown: onKey(Keys.Enter, submit) });
\`\`\`
`,

  skeleton: `
## Skeleton Loaders

Loading state components.

\`\`\`js
import { Skeleton, SkeletonText, SkeletonCard, Spinner, LoadingDots } from 'what';

// Basic skeleton
h(Skeleton, { width: 200, height: 20 })

// Circle avatar
h(Skeleton, { width: 50, height: 50, circle: true })

// Text lines
h(SkeletonText, { lines: 3 })

// Card placeholder
h(SkeletonCard, { imageHeight: 200 })

// Spinner
h(Spinner, { size: 24 })

// Loading dots
h(LoadingDots, { size: 8 })
\`\`\`

Variants: 'shimmer' (default), 'pulse', 'wave'
`,

  ssr: `
## Server-Side Rendering

SSR, SSG, and hybrid rendering.

\`\`\`js
import { renderToString, renderToStream, definePage, server } from 'what/server';

// Render to string
const html = await renderToString(h(App));

// Stream rendering
for await (const chunk of renderToStream(h(App))) {
  response.write(chunk);
}

// Per-page config
export const page = definePage({
  mode: 'static',  // 'static' | 'server' | 'client' | 'hybrid'
});

// Server-only component
const Header = server(({ title }) => h('header', null, title));
\`\`\`
`,

  cli: `
## CLI Commands

\`\`\`bash
what dev        # Dev server with HMR
what build      # Production build
what preview    # Preview production build
what generate   # Static site generation
\`\`\`

## Configuration

\`\`\`js
// what.config.js
export default {
  mode: 'hybrid',
  pagesDir: 'src/pages',
  outDir: 'dist',
  islands: true,
  port: 3000,
};
\`\`\`
`,
};

// Create server
const server = new Server(
  {
    name: 'what-framework',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'what_overview',
        description: 'Get an overview of What Framework',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_signals',
        description: 'Learn about signals and reactive primitives in What Framework',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_components',
        description: 'Learn about creating components and the h() function',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_hooks',
        description: 'Learn about React-compatible hooks (useState, useEffect, etc.)',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_islands',
        description: 'Learn about islands architecture and partial hydration',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_routing',
        description: 'Learn about file-based and programmatic routing',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_forms',
        description: 'Learn about form utilities and validation',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_data_fetching',
        description: 'Learn about data fetching with useSWR and useQuery',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_animation',
        description: 'Learn about animation primitives (spring, tween, gestures)',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_accessibility',
        description: 'Learn about accessibility utilities',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_skeleton',
        description: 'Learn about skeleton loaders and loading states',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_ssr',
        description: 'Learn about server-side rendering and static generation',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_cli',
        description: 'Learn about CLI commands and configuration',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'what_search',
        description: 'Search across all What Framework documentation',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
          },
          required: ['query'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'what_overview':
      return { content: [{ type: 'text', text: DOCS.overview }] };
    case 'what_signals':
      return { content: [{ type: 'text', text: DOCS.signals }] };
    case 'what_components':
      return { content: [{ type: 'text', text: DOCS.components }] };
    case 'what_hooks':
      return { content: [{ type: 'text', text: DOCS.hooks }] };
    case 'what_islands':
      return { content: [{ type: 'text', text: DOCS.islands }] };
    case 'what_routing':
      return { content: [{ type: 'text', text: DOCS.routing }] };
    case 'what_forms':
      return { content: [{ type: 'text', text: DOCS.forms }] };
    case 'what_data_fetching':
      return { content: [{ type: 'text', text: DOCS.dataFetching }] };
    case 'what_animation':
      return { content: [{ type: 'text', text: DOCS.animation }] };
    case 'what_accessibility':
      return { content: [{ type: 'text', text: DOCS.accessibility }] };
    case 'what_skeleton':
      return { content: [{ type: 'text', text: DOCS.skeleton }] };
    case 'what_ssr':
      return { content: [{ type: 'text', text: DOCS.ssr }] };
    case 'what_cli':
      return { content: [{ type: 'text', text: DOCS.cli }] };
    case 'what_search': {
      const query = args?.query?.toLowerCase() || '';
      const results = [];

      for (const [topic, content] of Object.entries(DOCS)) {
        if (content.toLowerCase().includes(query)) {
          results.push({
            topic,
            excerpt: content.substring(0, 200) + '...',
          });
        }
      }

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `No results found for "${query}"` }],
        };
      }

      const text = results
        .map((r) => `## ${r.topic}\n${r.excerpt}`)
        .join('\n\n---\n\n');

      return { content: [{ type: 'text', text }] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('What Framework MCP Server running on stdio');
}

main().catch(console.error);
