#!/usr/bin/env node

// create-what
// Canonical scaffold for What Framework projects.
// Usage:
//   npx create-what my-app
//   npx create-what my-app --vanilla

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('-'));
const positional = args.filter(a => !a.startsWith('-'));

const projectName = positional[0] || 'my-what-app';
const useJSX = !flags.includes('--no-jsx') && !flags.includes('--vanilla');

const root = join(process.cwd(), projectName);

if (existsSync(root)) {
  console.error(`\nError: "${projectName}" already exists.`);
  process.exit(1);
}

mkdirSync(join(root, 'src'), { recursive: true });
mkdirSync(join(root, 'public'), { recursive: true });

const ext = useJSX ? 'jsx' : 'js';
const entry = `src/main.${ext}`;

writeFileSync(join(root, '.gitignore'), `node_modules\ndist\n.DS_Store\n`);

writeFileSync(join(root, 'package.json'), JSON.stringify({
  name: projectName,
  private: true,
  version: '0.1.0',
  type: 'module',
  scripts: {
    dev: 'vite',
    build: 'vite build',
    preview: 'vite preview',
  },
  dependencies: {
    'what-framework': '^0.4.2',
  },
  devDependencies: {
    vite: '^5.4.0',
    ...(useJSX ? { 'what-compiler': '^0.4.2' } : {}),
  },
}, null, 2) + '\n');

writeFileSync(join(root, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/${entry}"></script>
  </body>
</html>
`);

if (useJSX) {
  writeFileSync(join(root, 'vite.config.js'), `import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

export default defineConfig({
  plugins: [what()],
});
`);

  writeFileSync(join(root, 'src', 'main.jsx'), `import { mount, useSignal } from 'what-framework';

function App() {
  const count = useSignal(0);

  return (
    <main className="app-shell">
      <h1>What Framework</h1>
      <p>Compiler-first JSX, React-familiar authoring.</p>

      <section className="counter">
        <button onClick={() => count.set(c => c - 1)}>-</button>
        <output>{count()}</output>
        <button onClick={() => count.set(c => c + 1)}>+</button>
      </section>
    </main>
  );
}

mount(<App />, '#app');
`);
} else {
  writeFileSync(join(root, 'vite.config.js'), `import { defineConfig } from 'vite';

export default defineConfig({});
`);

  writeFileSync(join(root, 'src', 'main.js'), `import { h, mount, signal } from 'what-framework';

function App() {
  const count = signal(0);

  return h('main', { class: 'app-shell' },
    h('h1', null, 'What Framework'),
    h('p', null, 'Runtime h() path (advanced).'),
    h('section', { class: 'counter' },
      h('button', { onClick: () => count.set(c => c - 1) }, '-'),
      h('output', null, () => count()),
      h('button', { onClick: () => count.set(c => c + 1) }, '+'),
    ),
  );
}

mount(h(App), '#app');
`);
}

writeFileSync(join(root, 'src', 'styles.css'), `:root {
  color-scheme: light;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #f4f6fb;
  color: #0f172a;
}

.app-shell {
  width: min(560px, calc(100vw - 2rem));
  background: #ffffff;
  border: 1px solid #dbe2ee;
  border-radius: 16px;
  padding: 2rem;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.06);
}

.counter {
  margin-top: 1rem;
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
}

button {
  border: 1px solid #9aa7bb;
  background: #ffffff;
  color: #0f172a;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 10px;
  cursor: pointer;
}

button:hover {
  border-color: #2563eb;
}

output {
  min-width: 2ch;
  text-align: center;
  font-weight: 700;
}
`);

writeFileSync(join(root, 'README.md'), `# ${projectName}

## Run

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:5173](http://localhost:5173).

## Notes

- Canonical package name is \`what-framework\`.
- JSX path is compiler-first and recommended.
- Runtime \`h()\` path is available with \`--vanilla\`.
- Event handlers accept both \`onClick\` and \`onclick\`; docs and templates use \`onClick\`.
`);

console.log(`\nCreated ${projectName} (${useJSX ? 'jsx' : 'vanilla'} mode).`);
console.log('Next steps:');
console.log(`  cd ${projectName}`);
console.log('  npm install');
console.log('  npm run dev\n');
