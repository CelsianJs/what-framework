#!/usr/bin/env node

// create-what: npm create what@latest my-app
// Scaffolds a new What framework project with sensible defaults.

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const name = process.argv[2] || 'my-what-app';
const template = process.argv[3] || 'default'; // default | minimal | full
const cwd = process.cwd();
const root = join(cwd, name);

if (existsSync(root)) {
  console.error(`\n  Error: "${name}" already exists.\n`);
  process.exit(1);
}

console.log(`\n  Creating ${name} with template: ${template}\n`);

// Create directory structure
const dirs = [
  'src/pages',
  'src/components',
  'src/layouts',
  'src/islands',
  'public',
];
dirs.forEach(d => mkdirSync(join(root, d), { recursive: true }));

// --- package.json ---
writeFileSync(join(root, 'package.json'), JSON.stringify({
  name,
  private: true,
  version: '0.0.1',
  type: 'module',
  scripts: {
    dev: 'what dev',
    build: 'what build',
    preview: 'what preview',
    generate: 'what generate',
  },
  dependencies: {
    'what-fw': '^0.1.0',
  },
}, null, 2) + '\n');

// --- what.config.js ---
writeFileSync(join(root, 'what.config.js'), `// What Framework Configuration
export default {
  // Rendering mode: 'static' | 'server' | 'client' | 'hybrid'
  mode: 'hybrid',

  // Pages directory (file-based routing)
  pagesDir: 'src/pages',

  // Build output
  outDir: 'dist',

  // Islands: components that hydrate independently
  islands: true,
};
`);

// --- src/index.html ---
writeFileSync(join(root, 'src/index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
`);

// --- src/app.js ---
writeFileSync(join(root, 'src/app.js'), `import { h, mount, signal } from 'what';
import { Router, Link, defineRoutes } from 'what/router';
import { Layout } from './layouts/main.js';
import { Home } from './pages/index.js';
import { About } from './pages/about.js';

const routes = defineRoutes({
  '/': { component: Home, layout: Layout },
  '/about': { component: About, layout: Layout },
});

function App() {
  return h(Router, { routes, fallback: NotFound });
}

function NotFound() {
  return h('div', { class: 'not-found' },
    h('h1', null, '404'),
    h('p', null, 'Page not found'),
    h(Link, { href: '/' }, 'Go home'),
  );
}

mount(h(App), '#app');
`);

// --- src/layouts/main.js ---
writeFileSync(join(root, 'src/layouts/main.js'), `import { h } from 'what';
import { Link } from 'what/router';
import { Nav } from '../components/nav.js';

export function Layout({ children }) {
  return h('div', { class: 'layout' },
    h(Nav),
    h('main', { class: 'content' }, children),
    h('footer', { class: 'footer' },
      h('p', null, 'Built with What'),
    ),
  );
}
`);

// --- src/components/nav.js ---
writeFileSync(join(root, 'src/components/nav.js'), `import { h } from 'what';
import { Link } from 'what/router';

export function Nav() {
  return h('nav', { class: 'nav' },
    h('a', { href: '/', class: 'nav-logo' }, 'What'),
    h('div', { class: 'nav-links' },
      h(Link, { href: '/' }, 'Home'),
      h(Link, { href: '/about' }, 'About'),
    ),
  );
}
`);

// --- src/pages/index.js ---
writeFileSync(join(root, 'src/pages/index.js'), `import { h, useState } from 'what';

export function Home() {
  const [count, setCount] = useState(0);

  return h('div', { class: 'page home' },
    h('h1', null, 'Welcome to What'),
    h('p', null, 'The closest framework to vanilla JS.'),
    h('div', { class: 'counter' },
      h('button', { onClick: () => setCount(c => c - 1) }, '-'),
      h('span', { class: 'count' }, count),
      h('button', { onClick: () => setCount(c => c + 1) }, '+'),
    ),
  );
}

export default Home;
`);

// --- src/pages/about.js ---
writeFileSync(join(root, 'src/pages/about.js'), `import { h } from 'what';

export function About() {
  return h('div', { class: 'page about' },
    h('h1', null, 'About What'),
    h('p', null, 'What is a vanilla JS framework that gives you:'),
    h('ul', null,
      h('li', null, 'Fine-grained reactivity (signals)'),
      h('li', null, 'Surgical DOM updates (no virtual DOM diffing)'),
      h('li', null, 'Islands architecture (ship zero JS by default)'),
      h('li', null, 'File-based routing'),
      h('li', null, 'SSR + SSG + client rendering'),
      h('li', null, 'React-familiar hooks API'),
    ),
  );
}

export default About;
`);

// --- public/styles.css ---
writeFileSync(join(root, 'public/styles.css'), `* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  line-height: 1.6;
  color: #1a1a2e;
  background: #fafafa;
}

.layout { min-height: 100vh; display: flex; flex-direction: column; }
.content { flex: 1; max-width: 800px; margin: 0 auto; padding: 2rem; width: 100%; }

.nav {
  display: flex; align-items: center; gap: 2rem;
  padding: 1rem 2rem; background: #1a1a2e; color: white;
}
.nav-logo { color: white; text-decoration: none; font-weight: 700; font-size: 1.25rem; }
.nav-links { display: flex; gap: 1rem; }
.nav-links a { color: #a0a0c0; text-decoration: none; transition: color 0.2s; }
.nav-links a:hover { color: white; }

.footer { padding: 1rem 2rem; text-align: center; color: #666; font-size: 0.875rem; }

h1 { font-size: 2.5rem; margin-bottom: 1rem; }
p { margin-bottom: 1rem; }

.counter {
  display: flex; align-items: center; gap: 1rem; margin-top: 1.5rem;
}
.counter button {
  width: 40px; height: 40px; border-radius: 8px; border: 2px solid #1a1a2e;
  background: white; font-size: 1.25rem; cursor: pointer; transition: all 0.15s;
}
.counter button:hover { background: #1a1a2e; color: white; }
.count { font-size: 2rem; font-weight: 700; min-width: 3rem; text-align: center; }

ul { margin-left: 1.5rem; margin-bottom: 1rem; }
li { margin-bottom: 0.25rem; }

.not-found { text-align: center; padding: 4rem 2rem; }
.not-found h1 { font-size: 6rem; color: #ddd; }
`);

console.log(`  Done! Next steps:\n`);
console.log(`    cd ${name}`);
console.log(`    npm install`);
console.log(`    npm run dev\n`);
