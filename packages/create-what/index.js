#!/usr/bin/env node

// create-what
// Canonical scaffold for What Framework projects.
// Usage:
//   npx create-what my-app
//   npx create-what my-app --yes   (skip prompts, use defaults)

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('-'));
const flags = new Set(args.filter(a => a.startsWith('-')));
const skipPrompts = flags.has('--yes') || flags.has('-y');

// ---------------------------------------------------------------------------
// Prompt helpers (zero-dependency, uses Node readline)
// ---------------------------------------------------------------------------

/**
 * Creates an async prompt interface that works with both TTY and piped stdin.
 * When stdin is piped, readline can close before all questions are asked.
 * We buffer all incoming lines to handle this gracefully.
 */
function createPrompter() {
  const lines = [];
  let lineResolve = null;
  let closed = false;

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY ?? false });

  rl.on('line', (line) => {
    if (lineResolve) {
      const resolve = lineResolve;
      lineResolve = null;
      resolve(line);
    } else {
      lines.push(line);
    }
  });

  rl.on('close', () => {
    closed = true;
    if (lineResolve) {
      const resolve = lineResolve;
      lineResolve = null;
      resolve('');
    }
  });

  function ask(question) {
    process.stdout.write(question);
    if (lines.length > 0) return Promise.resolve(lines.shift());
    if (closed) return Promise.resolve('');
    return new Promise(resolve => { lineResolve = resolve; });
  }

  async function confirm(message, defaultYes = false) {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    const answer = (await ask(`  ${message} ${hint} `)).trim().toLowerCase();
    if (answer === '') return defaultYes;
    return answer === 'y' || answer === 'yes';
  }

  async function select(message, choices) {
    console.log(`  ${message}`);
    choices.forEach((c, i) => console.log(`    ${i + 1}) ${c.label}`));
    const answer = (await ask(`  Choice [1]: `)).trim();
    const idx = answer === '' ? 0 : parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < choices.length) return choices[idx].value;
    return choices[0].value;
  }

  function close() {
    rl.close();
  }

  return { ask, confirm, select, close };
}

// ---------------------------------------------------------------------------
// Gather options
// ---------------------------------------------------------------------------
async function gatherOptions() {
  let projectName = positional[0];
  let reactCompat = false;
  let cssApproach = 'none'; // 'none' | 'tailwind' | 'stylex'

  if (skipPrompts) {
    projectName = projectName || 'my-what-app';
    return { projectName, reactCompat, cssApproach };
  }

  const prompter = createPrompter();

  console.log('\n  create-what - scaffold a What Framework project\n');

  if (!projectName) {
    projectName = (await prompter.ask('  Project name: ')).trim() || 'my-what-app';
  }

  reactCompat = await prompter.confirm('Add React library support? (what-react)');

  cssApproach = await prompter.select('CSS approach:', [
    { label: 'None (vanilla CSS)', value: 'none' },
    { label: 'Tailwind CSS v4', value: 'tailwind' },
    { label: 'StyleX', value: 'stylex' },
  ]);

  prompter.close();

  return { projectName, reactCompat, cssApproach };
}

// ---------------------------------------------------------------------------
// File generators
// ---------------------------------------------------------------------------

function generatePackageJson(projectName, { reactCompat, cssApproach }) {
  const deps = {
    'what-framework': '^0.6.0',
  };
  const devDeps = {
    vite: '^6.0.0',
    'what-compiler': '^0.6.0',
    '@babel/core': '^7.23.0',
  };

  if (reactCompat) {
    deps['what-react'] = '^0.1.0';
    deps['what-core'] = '^0.6.0';
    // Include zustand as a demo React library
    deps['zustand'] = '^5.0.0';
  }

  if (cssApproach === 'tailwind') {
    devDeps['tailwindcss'] = '^4.0.0';
    devDeps['@tailwindcss/vite'] = '^4.0.0';
  }

  if (cssApproach === 'stylex') {
    devDeps['@stylexjs/stylex'] = '^0.10.0';
    devDeps['vite-plugin-stylex'] = '^0.12.0';
  }

  return JSON.stringify({
    name: projectName,
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
    },
    dependencies: deps,
    devDependencies: devDeps,
  }, null, 2) + '\n';
}

function generateViteConfig({ reactCompat, cssApproach }) {
  const imports = [];
  const plugins = [];

  imports.push(`import { defineConfig } from 'vite';`);

  if (reactCompat) {
    // React compat projects use the what-react Vite plugin instead of the
    // What compiler. The what-react plugin aliases react/react-dom imports
    // to what-react, which runs React code on What Framework's signal engine.
    imports.push(`import { reactCompat } from 'what-react/vite';`);
    plugins.push('reactCompat()');
  } else {
    // Standard What Framework projects use the What compiler for JSX
    imports.push(`import what from 'what-compiler/vite';`);
    plugins.push('what()');
  }

  if (cssApproach === 'tailwind') {
    imports.push(`import tailwindcss from '@tailwindcss/vite';`);
    plugins.push('tailwindcss()');
  }

  if (cssApproach === 'stylex') {
    imports.push(`import stylexPlugin from 'vite-plugin-stylex';`);
    plugins.push('stylexPlugin()');
  }

  let config = `${imports.join('\n')}

export default defineConfig({
  plugins: [${plugins.join(', ')}],`;

  if (reactCompat) {
    // Note: the what-react/vite plugin handles optimizeDeps.exclude and
    // resolve.alias automatically. No manual configuration needed.
    config += `
  // what-react/vite handles all React aliasing and optimizeDeps automatically.
  // Any React library you install (zustand, @tanstack/react-query, etc.)
  // will be auto-detected and excluded from pre-bundling.`;
  }

  config += '\n});\n';
  return config;
}

function generateIndexHtml(projectName) {
  return `<!doctype html>
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
`;
}

function generateStyles({ cssApproach }) {
  if (cssApproach === 'tailwind') {
    // Tailwind v4: just one import, utility classes handle the rest
    return `@import "tailwindcss";

/* Custom styles — use Tailwind utility classes in your JSX instead */
`;
  }

  // Vanilla CSS and StyleX both get a baseline stylesheet
  return `:root {
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
`;
}

function generateMainJsx({ reactCompat, cssApproach }) {
  if (reactCompat) {
    return generateMainWithReactCompat({ cssApproach });
  }
  if (cssApproach === 'stylex') {
    return generateMainWithStyleX();
  }
  if (cssApproach === 'tailwind') {
    return generateMainWithTailwind();
  }
  return generateMainDefault();
}

function generateMainDefault() {
  return `import { mount, useSignal } from 'what-framework';

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
`;
}

function generateMainWithTailwind() {
  return `import { mount, useSignal } from 'what-framework';

function App() {
  const count = useSignal(0);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 shadow-lg">
        <h1 className="text-2xl font-bold text-slate-900">What Framework</h1>
        <p className="mt-1 text-slate-500">Compiler-first JSX + Tailwind CSS.</p>

        <section className="mt-6 inline-flex items-center gap-3">
          <button
            className="w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-900 hover:border-blue-600 cursor-pointer"
            onClick={() => count.set(c => c - 1)}
          >
            -
          </button>
          <output className="min-w-[2ch] text-center font-bold">{count()}</output>
          <button
            className="w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-900 hover:border-blue-600 cursor-pointer"
            onClick={() => count.set(c => c + 1)}
          >
            +
          </button>
        </section>
      </div>
    </main>
  );
}

mount(<App />, '#app');
`;
}

function generateMainWithStyleX() {
  return `import { mount, useSignal } from 'what-framework';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    background: '#f4f6fb',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  },
  shell: {
    width: 'min(560px, calc(100vw - 2rem))',
    background: '#ffffff',
    border: '1px solid #dbe2ee',
    borderRadius: 16,
    padding: '2rem',
    boxShadow: '0 16px 40px rgba(15, 23, 42, 0.06)',
  },
  heading: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#0f172a',
  },
  subtitle: {
    marginTop: '0.25rem',
    color: '#64748b',
  },
  counter: {
    marginTop: '1rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  button: {
    width: '2.25rem',
    height: '2.25rem',
    borderRadius: 10,
    border: '1px solid #9aa7bb',
    background: '#ffffff',
    color: '#0f172a',
    cursor: 'pointer',
    ':hover': {
      borderColor: '#2563eb',
    },
  },
  output: {
    minWidth: '2ch',
    textAlign: 'center',
    fontWeight: 700,
  },
});

function App() {
  const count = useSignal(0);

  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.shell)}>
        <h1 {...stylex.props(styles.heading)}>What Framework</h1>
        <p {...stylex.props(styles.subtitle)}>Compiler-first JSX + StyleX.</p>

        <section {...stylex.props(styles.counter)}>
          <button {...stylex.props(styles.button)} onClick={() => count.set(c => c - 1)}>-</button>
          <output {...stylex.props(styles.output)}>{count()}</output>
          <button {...stylex.props(styles.button)} onClick={() => count.set(c => c + 1)}>+</button>
        </section>
      </div>
    </main>
  );
}

mount(<App />, '#app');
`;
}

function generateMainWithReactCompat({ cssApproach }) {
  // React compat demo: uses zustand (a real React library) to show it works
  // with What Framework under the hood.
  if (cssApproach === 'tailwind') {
    return `import { mount, useSignal } from 'what-framework';
import { create } from 'zustand';

// A real React state library — works with What Framework via what-react!
const useStore = create((set) => ({
  bears: 0,
  increase: () => set((state) => ({ bears: state.bears + 1 })),
  reset: () => set({ bears: 0 }),
}));

function BearCounter() {
  // useStore is a React hook from zustand — what-react makes it work seamlessly
  const bears = useStore((state) => state.bears);
  const increase = useStore((state) => state.increase);
  const reset = useStore((state) => state.reset);

  return (
    <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
      <p className="text-sm text-amber-700 font-medium">Zustand Store (React library)</p>
      <p className="mt-1 text-2xl font-bold text-amber-900">{bears} bears</p>
      <div className="mt-2 flex gap-2">
        <button
          className="px-3 py-1 rounded-lg border border-amber-300 bg-white text-amber-800 hover:border-amber-500 cursor-pointer text-sm"
          onClick={increase}
        >
          Add bear
        </button>
        <button
          className="px-3 py-1 rounded-lg border border-amber-300 bg-white text-amber-800 hover:border-amber-500 cursor-pointer text-sm"
          onClick={reset}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function App() {
  const count = useSignal(0);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 shadow-lg">
        <h1 className="text-2xl font-bold text-slate-900">What Framework</h1>
        <p className="mt-1 text-slate-500">React compat + Tailwind CSS.</p>

        <section className="mt-6 inline-flex items-center gap-3">
          <button
            className="w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-900 hover:border-blue-600 cursor-pointer"
            onClick={() => count.set(c => c - 1)}
          >
            -
          </button>
          <output className="min-w-[2ch] text-center font-bold">{count()}</output>
          <button
            className="w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-900 hover:border-blue-600 cursor-pointer"
            onClick={() => count.set(c => c + 1)}
          >
            +
          </button>
        </section>

        <BearCounter />
      </div>
    </main>
  );
}

mount(<App />, '#app');
`;
  }

  if (cssApproach === 'stylex') {
    return `import { mount, useSignal } from 'what-framework';
import { create } from 'zustand';
import * as stylex from '@stylexjs/stylex';

const styles = stylex.create({
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    background: '#f4f6fb',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  },
  shell: {
    width: 'min(560px, calc(100vw - 2rem))',
    background: '#ffffff',
    border: '1px solid #dbe2ee',
    borderRadius: 16,
    padding: '2rem',
    boxShadow: '0 16px 40px rgba(15, 23, 42, 0.06)',
  },
  heading: { fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' },
  subtitle: { marginTop: '0.25rem', color: '#64748b' },
  counter: {
    marginTop: '1rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  button: {
    width: '2.25rem',
    height: '2.25rem',
    borderRadius: 10,
    border: '1px solid #9aa7bb',
    background: '#ffffff',
    color: '#0f172a',
    cursor: 'pointer',
    ':hover': { borderColor: '#2563eb' },
  },
  output: { minWidth: '2ch', textAlign: 'center', fontWeight: 700 },
  zustandBox: {
    marginTop: '1.5rem',
    padding: '1rem',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 12,
  },
  zustandLabel: { fontSize: '0.875rem', color: '#92400e', fontWeight: 500 },
  zustandCount: { marginTop: '0.25rem', fontSize: '1.5rem', fontWeight: 700, color: '#78350f' },
  zustandButtons: { marginTop: '0.5rem', display: 'flex', gap: '0.5rem' },
  zustandBtn: {
    padding: '0.25rem 0.75rem',
    borderRadius: 8,
    border: '1px solid #fbbf24',
    background: '#ffffff',
    color: '#78350f',
    cursor: 'pointer',
    fontSize: '0.875rem',
    ':hover': { borderColor: '#d97706' },
  },
});

// A real React state library — works with What Framework via what-react!
const useStore = create((set) => ({
  bears: 0,
  increase: () => set((state) => ({ bears: state.bears + 1 })),
  reset: () => set({ bears: 0 }),
}));

function BearCounter() {
  const bears = useStore((state) => state.bears);
  const increase = useStore((state) => state.increase);
  const reset = useStore((state) => state.reset);

  return (
    <div {...stylex.props(styles.zustandBox)}>
      <p {...stylex.props(styles.zustandLabel)}>Zustand Store (React library)</p>
      <p {...stylex.props(styles.zustandCount)}>{bears} bears</p>
      <div {...stylex.props(styles.zustandButtons)}>
        <button {...stylex.props(styles.zustandBtn)} onClick={increase}>Add bear</button>
        <button {...stylex.props(styles.zustandBtn)} onClick={reset}>Reset</button>
      </div>
    </div>
  );
}

function App() {
  const count = useSignal(0);

  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.shell)}>
        <h1 {...stylex.props(styles.heading)}>What Framework</h1>
        <p {...stylex.props(styles.subtitle)}>React compat + StyleX.</p>

        <section {...stylex.props(styles.counter)}>
          <button {...stylex.props(styles.button)} onClick={() => count.set(c => c - 1)}>-</button>
          <output {...stylex.props(styles.output)}>{count()}</output>
          <button {...stylex.props(styles.button)} onClick={() => count.set(c => c + 1)}>+</button>
        </section>

        <BearCounter />
      </div>
    </main>
  );
}

mount(<App />, '#app');
`;
  }

  // React compat with vanilla CSS
  return `import { mount, useSignal } from 'what-framework';
import { create } from 'zustand';

// A real React state library — works with What Framework via what-react!
const useStore = create((set) => ({
  bears: 0,
  increase: () => set((state) => ({ bears: state.bears + 1 })),
  reset: () => set({ bears: 0 }),
}));

function BearCounter() {
  // useStore is a React hook from zustand — what-react makes it work seamlessly
  const bears = useStore((state) => state.bears);
  const increase = useStore((state) => state.increase);
  const reset = useStore((state) => state.reset);

  return (
    <div className="zustand-demo">
      <p className="zustand-label">Zustand Store (React library)</p>
      <p className="zustand-count">{bears} bears</p>
      <div className="zustand-buttons">
        <button className="zustand-btn" onClick={increase}>Add bear</button>
        <button className="zustand-btn" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}

function App() {
  const count = useSignal(0);

  return (
    <main className="app-shell">
      <h1>What Framework</h1>
      <p>React compat enabled — use React libraries with signals.</p>

      <section className="counter">
        <button onClick={() => count.set(c => c - 1)}>-</button>
        <output>{count()}</output>
        <button onClick={() => count.set(c => c + 1)}>+</button>
      </section>

      <BearCounter />
    </main>
  );
}

mount(<App />, '#app');
`;
}

function generateStylesWithReactCompat() {
  return `:root {
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

/* Zustand demo */
.zustand-demo {
  margin-top: 1.5rem;
  padding: 1rem;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 12px;
}

.zustand-label {
  font-size: 0.875rem;
  color: #92400e;
  font-weight: 500;
  margin: 0;
}

.zustand-count {
  margin: 0.25rem 0 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: #78350f;
}

.zustand-buttons {
  margin-top: 0.5rem;
  display: flex;
  gap: 0.5rem;
}

.zustand-btn {
  width: auto;
  height: auto;
  padding: 0.25rem 0.75rem;
  border-radius: 8px;
  border: 1px solid #fbbf24;
  background: #ffffff;
  color: #78350f;
  cursor: pointer;
  font-size: 0.875rem;
}

.zustand-btn:hover {
  border-color: #d97706;
}
`;
}

function generateReadme(projectName, { reactCompat, cssApproach }) {
  let notes = `- Canonical package name is \`what-framework\`.
- Uses the What compiler for JSX transforms and automatic reactivity.
- Vite is preconfigured; use \`npm run dev/build/preview\`.
- Event handlers accept both \`onClick\` and \`onclick\`; docs and templates use \`onClick\`.
- Bun is also supported: \`bun create what@latest\`, \`bun run dev\`.`;

  if (reactCompat) {
    notes += `
- React compat is enabled via \`what-react\`. Any React library (zustand, @tanstack/react-query, framer-motion, etc.) works out of the box.
- The \`what-react/vite\` plugin handles all aliasing automatically.`;
  }

  if (cssApproach === 'tailwind') {
    notes += `
- Tailwind CSS v4 is configured via the \`@tailwindcss/vite\` plugin.`;
  }

  if (cssApproach === 'stylex') {
    notes += `
- StyleX is configured via \`vite-plugin-stylex\`. Define styles with \`stylex.create()\` and apply with \`{...stylex.props()}\`.`;
  }

  return `# ${projectName}

## Run

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:5173](http://localhost:5173).

## Notes

${notes}
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const options = await gatherOptions();
  const { projectName, reactCompat, cssApproach } = options;

  const root = join(process.cwd(), projectName);

  if (existsSync(root)) {
    console.error(`\nError: "${projectName}" already exists.`);
    process.exit(1);
  }

  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'public'), { recursive: true });
  // MCP config dirs — created but left empty until what-devtools-mcp is published
  // mkdirSync(join(root, '.claude'), { recursive: true });
  // mkdirSync(join(root, '.cursor'), { recursive: true });

  // .gitignore
  writeFileSync(join(root, '.gitignore'), `node_modules\ndist\n.DS_Store\n`);

  // package.json
  writeFileSync(join(root, 'package.json'), generatePackageJson(projectName, options));

  // index.html
  writeFileSync(join(root, 'index.html'), generateIndexHtml(projectName));

  // favicon
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

  // vite.config.js
  writeFileSync(join(root, 'vite.config.js'), generateViteConfig(options));

  // tsconfig.json
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'preserve',
      jsxImportSource: 'what-framework',
      allowJs: true,
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

  // .vscode
  mkdirSync(join(root, '.vscode'), { recursive: true });

  writeFileSync(join(root, '.vscode', 'settings.json'), JSON.stringify({
    'typescript.tsdk': 'node_modules/typescript/lib',
    'editor.formatOnSave': true,
  }, null, 2) + '\n');

  writeFileSync(join(root, '.vscode', 'extensions.json'), JSON.stringify({
    recommendations: [],
  }, null, 2) + '\n');

  // src/main.jsx
  writeFileSync(join(root, 'src', 'main.jsx'), generateMainJsx(options));

  // src/styles.css
  if (reactCompat && cssApproach === 'none') {
    writeFileSync(join(root, 'src', 'styles.css'), generateStylesWithReactCompat());
  } else {
    writeFileSync(join(root, 'src', 'styles.css'), generateStyles(options));
  }

  // README.md
  writeFileSync(join(root, 'README.md'), generateReadme(projectName, options));

  // Summary
  console.log(`\nCreated ${projectName}.`);

  const features = [];
  if (reactCompat) features.push('React compat (what-react + zustand demo)');
  if (cssApproach === 'tailwind') features.push('Tailwind CSS v4');
  if (cssApproach === 'stylex') features.push('StyleX');
  if (features.length > 0) {
    console.log(`Features: ${features.join(', ')}`);
  }

  console.log('\nNext steps:');
  console.log(`  cd ${projectName}`);
  console.log('  npm install');
  console.log('  npm run dev\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
