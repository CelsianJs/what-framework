#!/usr/bin/env node

// create-what
// Canonical scaffold for What Framework projects.
// Usage:
//   npx create-what my-app

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('-'));

const projectName = positional[0] || 'my-what-app';

const root = join(process.cwd(), projectName);

if (existsSync(root)) {
  console.error(`\nError: "${projectName}" already exists.`);
  process.exit(1);
}

mkdirSync(join(root, 'src'), { recursive: true });
mkdirSync(join(root, 'public'), { recursive: true });

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
    'what-framework': '^0.5.2',
  },
  devDependencies: {
    vite: '^5.4.0',
    'what-compiler': '^0.5.2',
  },
}, null, 2) + '\n');

writeFileSync(join(root, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`);

writeFileSync(join(root, 'public', 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#2563eb" />
      <stop offset="100%" stop-color="#1d4ed8" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)" />
  <path d="M17 20h10l5 20 5-20h10L36 49h-8z" fill="#fff" />
</svg>
`);

writeFileSync(join(root, 'vite.config.js'), `import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

export default defineConfig({
  plugins: [what()],
});
`);

// TypeScript configuration (works for both .jsx and .tsx projects)
writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'preserve',
    jsxImportSource: 'what-core',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    isolatedModules: true,
    types: ['vite/client'],
  },
  include: ['src'],
}, null, 2) + '\n');

// VS Code workspace settings
mkdirSync(join(root, '.vscode'), { recursive: true });

writeFileSync(join(root, '.vscode', 'settings.json'), JSON.stringify({
  'typescript.tsdk': 'node_modules/typescript/lib',
  'editor.formatOnSave': true,
}, null, 2) + '\n');

writeFileSync(join(root, '.vscode', 'extensions.json'), JSON.stringify({
  recommendations: [
    'zvndev.thenjs',
  ],
}, null, 2) + '\n');

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
- Uses the What compiler for JSX transforms and automatic reactivity.
- Vite is preconfigured; use \`npm run dev/build/preview\`.
- Event handlers accept both \`onClick\` and \`onclick\`; docs and templates use \`onClick\`.
- Bun is also supported: \`bun create what@latest\`, \`bun run dev\`.
`);

console.log(`\nCreated ${projectName}.`);
console.log('Next steps:');
console.log(`  cd ${projectName}`);
console.log('  npm install');
console.log('  npm run dev\n');
