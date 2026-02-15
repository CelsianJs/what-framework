#!/usr/bin/env node

// create-what: npm create what@latest my-app
// Scaffolds a new What Framework project with sensible defaults.
//
// Usage:
//   npm create what@latest my-app           # JSX project (default)
//   npm create what@latest my-app --no-jsx  # vanilla h() project
//   npm create what@latest my-app --vanilla # vanilla h() project

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// --- Parse CLI arguments ---
const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('-'));
const positional = args.filter(a => !a.startsWith('-'));

const name = positional[0] || 'my-what-app';
const template = positional[1] || 'default'; // default | minimal | full

// JSX is the default; opt out with --no-jsx or --vanilla
const useJSX = !flags.includes('--no-jsx') && !flags.includes('--vanilla');

const cwd = process.cwd();
const root = join(cwd, name);

if (existsSync(root)) {
  console.error(`\n  Error: "${name}" already exists.\n`);
  process.exit(1);
}

const mode = useJSX ? 'JSX' : 'vanilla (h())';
console.log(`\n  Creating ${name} with template: ${template} (${mode})\n`);

// File extension helper
const ext = useJSX ? '.jsx' : '.js';

// Create directory structure
const dirs = [
  'src/pages',
  'src/components',
  'src/layouts',
  'src/islands',
  'public',
];
dirs.forEach(d => mkdirSync(join(root, d), { recursive: true }));

// --- .gitignore ---
writeFileSync(join(root, '.gitignore'), `node_modules
dist
.vite
.DS_Store
*.local
`);

// --- package.json ---
const pkgDeps = {
  'what-framework': '^0.3.0',
  'what-framework-cli': '^0.1.0',
};

const pkgDevDeps = useJSX
  ? {
      'what-compiler': '^0.3.0',
      '@babel/core': '^7.23.0',
      'vite': '^5.0.0',
    }
  : {};

const pkg = {
  name,
  private: true,
  version: '0.0.1',
  type: 'module',
  scripts: {
    dev: useJSX ? 'vite' : 'what dev',
    build: useJSX ? 'vite build' : 'what build',
    preview: useJSX ? 'vite preview' : 'what preview',
    generate: 'what generate',
  },
  dependencies: pkgDeps,
};

if (Object.keys(pkgDevDeps).length > 0) {
  pkg.devDependencies = pkgDevDeps;
}

writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// --- vite.config.js (JSX only) ---
if (useJSX) {
  writeFileSync(join(root, 'vite.config.js'), `import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

export default defineConfig({
  plugins: [what()],
});
`);
}

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

// --- index.html (root — required by Vite) ---
const appScript = useJSX ? '/src/app.jsx' : '/src/app.js';
writeFileSync(join(root, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${appScript}"></script>
</body>
</html>
`);

// ==========================================================================
// JSX templates
// ==========================================================================
if (useJSX) {

// --- src/app.jsx ---
writeFileSync(join(root, 'src/app.jsx'), `import { mount } from 'what-framework';
import { Router, Link, defineRoutes } from 'what-framework/router';
import { Layout } from './layouts/main.jsx';
import { Home } from './pages/index.jsx';
import { About } from './pages/about.jsx';

const routes = defineRoutes({
  '/': { component: Home, layout: Layout },
  '/about': { component: About, layout: Layout },
});

function App() {
  return <Router routes={routes} fallback={NotFound} />;
}

function NotFound() {
  return (
    <div class="not-found">
      <h1>404</h1>
      <p>Page not found</p>
      <Link href="/">Go home</Link>
    </div>
  );
}

mount(<App />, '#app');
`);

// --- src/layouts/main.jsx ---
writeFileSync(join(root, 'src/layouts/main.jsx'), `import { Nav } from '../components/nav.jsx';

export function Layout({ children }) {
  return (
    <div class="layout">
      <Nav />
      <main class="content">{children}</main>
      <footer class="footer">
        <p>Built with What</p>
      </footer>
    </div>
  );
}
`);

// --- src/components/nav.jsx ---
writeFileSync(join(root, 'src/components/nav.jsx'), `import { Link } from 'what-framework/router';

export function Nav() {
  return (
    <nav class="nav">
      <a href="/" class="nav-logo">What</a>
      <div class="nav-links">
        <Link href="/">Home</Link>
        <Link href="/about">About</Link>
      </div>
    </nav>
  );
}
`);

// --- src/pages/index.jsx ---
writeFileSync(join(root, 'src/pages/index.jsx'), `import { useState } from 'what-framework';

export function Home() {
  const [count, setCount] = useState(0);

  return (
    <div class="page home">
      <h1>Welcome to What</h1>
      <p>The closest framework to vanilla JS.</p>
      <div class="counter">
        <button onClick={() => setCount(c => c - 1)}>-</button>
        <span class="count">{count}</span>
        <button onClick={() => setCount(c => c + 1)}>+</button>
      </div>
    </div>
  );
}

export default Home;
`);

// --- src/pages/about.jsx ---
writeFileSync(join(root, 'src/pages/about.jsx'), `export function About() {
  return (
    <div class="page about">
      <h1>About What</h1>
      <p>What is a vanilla JS framework that gives you:</p>
      <ul>
        <li>Fine-grained reactivity (signals)</li>
        <li>Surgical DOM updates (no virtual DOM diffing)</li>
        <li>Islands architecture (ship zero JS by default)</li>
        <li>File-based routing</li>
        <li>SSR + SSG + client rendering</li>
        <li>React-familiar hooks API</li>
      </ul>
    </div>
  );
}

export default About;
`);

} else {
// ==========================================================================
// Vanilla h() templates
// ==========================================================================

// --- src/app.js ---
writeFileSync(join(root, 'src/app.js'), `import { h, mount, signal } from 'what-framework';
import { Router, Link, defineRoutes } from 'what-framework/router';
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
writeFileSync(join(root, 'src/layouts/main.js'), `import { h } from 'what-framework';
import { Link } from 'what-framework/router';
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
writeFileSync(join(root, 'src/components/nav.js'), `import { h } from 'what-framework';
import { Link } from 'what-framework/router';

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
writeFileSync(join(root, 'src/pages/index.js'), `import { h, useState } from 'what-framework';

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
writeFileSync(join(root, 'src/pages/about.js'), `import { h } from 'what-framework';

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

} // end vanilla mode

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

// --- README.md ---
const jsxNote = useJSX
  ? `This project uses **JSX** syntax, compiled by \`what-compiler\` via the Vite plugin.

To switch to vanilla \`h()\` calls instead, re-create with:
\`\`\`
npm create what@latest ${name} --vanilla
\`\`\``
  : `This project uses the vanilla **h()** API for building components.

To use JSX syntax instead (recommended), re-create with:
\`\`\`
npm create what@latest ${name}
\`\`\``;

writeFileSync(join(root, 'README.md'), `# ${name}

A [What Framework](https://github.com/aspect/what-fw) project.

## Authoring Mode

${jsxNote}

## Getting Started

\`\`\`bash
cd ${name}
npm install
npm run dev
\`\`\`

## Scripts

| Command         | Description                          |
| --------------- | ------------------------------------ |
| \`npm run dev\`   | Start development server             |
| \`npm run build\` | Build for production                 |
| \`npm run preview\`| Preview production build            |
| \`npm run generate\`| Static site generation (SSG)       |

## Project Structure

\`\`\`
${name}/
  src/
    pages/         # File-based routes
    components/    # Shared components
    layouts/       # Page layouts
    islands/       # Hydrated interactive islands
${useJSX ? '    app.jsx          # App entry point (JSX)' : '    app.js           # App entry point'}
  public/          # Static assets
  index.html       # HTML shell (Vite entry)
  what.config.js   # Framework configuration
${useJSX ? '  vite.config.js    # Vite + what-compiler plugin\n' : ''}  package.json
\`\`\`

## Learn More

- [What Framework docs](https://github.com/aspect/what-fw)
- JSX authoring: uses \`what-compiler\` to compile JSX to h() calls through the core reconciler
- Vanilla authoring: use \`h(tag, props, ...children)\` directly -- zero build step needed
`);

// --- styles.css (move from public/ to root for Vite) ---

// --- Done ---
console.log(`  Done! Next steps:\n`);
console.log(`    cd ${name}`);
console.log(`    npm install`);
console.log(`    npm run dev\n`);

if (useJSX) {
  console.log(`  JSX mode enabled. Components use .jsx extensions.`);
  console.log(`  The what-compiler Vite plugin compiles JSX to h() calls.`);
  console.log(`  Open http://localhost:5173 after running dev.\n`);
} else {
  console.log(`  Vanilla mode. Components use h() calls -- no compiler needed.\n`);
}
