#!/usr/bin/env node

// create-what
// Canonical scaffold for What Framework projects.
// Usage:
//   npx create-what my-app
//   npx create-what my-app --yes   (skip prompts, use defaults)

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline';

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--template') {
    i += 1;
    continue;
  }
  if (!arg.startsWith('-')) positional.push(arg);
}
const flags = new Set(args.filter(a => a.startsWith('-')));
const skipPrompts = flags.has('--yes') || flags.has('-y');
const showHelp = flags.has('--help') || flags.has('-h');
let templateFlag = flags.has('--fullstack') ? 'fullstack' : null;
for (const f of flags) { const m = f.match(/^--template=(.*)$/); if (m) templateFlag = m[1].trim(); }
const templateArgIndex = args.findIndex((a) => a === '--template');
if (templateArgIndex !== -1) {
  const value = args[templateArgIndex + 1];
  templateFlag = value && !value.startsWith('-') ? value.trim() : '';
}
const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const whatVersionRange = `^${packageVersion}`;
const validTemplates = new Set(['spa', 'fullstack', 'islands']);
const templateList = '"spa", "fullstack" or "islands"';

function shellQuotePath(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatCdTarget(inputPath, absoluteRoot) {
  let target = inputPath && !isAbsolute(inputPath) ? inputPath : absoluteRoot;
  if (!isAbsolute(target) && target.startsWith('-')) target = `./${target}`;
  return shellQuotePath(target);
}

if (showHelp) {
  console.log(`
  create-what - scaffold a What Framework project

  Usage:
    create-what [project-name] [options]

  Options:
    --fullstack         Scaffold a full-stack SSR app (file routes, loaders,
                        actions, origin-first ISR) instead of an SPA
    --template=<name>   'spa' (default), 'fullstack', or 'islands' (JSX pages
                        prerendered to static HTML, with interactive islands)
    -y, --yes           Skip prompts and use defaults
    -h, --help          Show this help message
`);
  process.exit(0);
}

if (templateFlag && !validTemplates.has(templateFlag)) {
  console.error(`\nError: unknown template "${templateFlag}". Expected ${templateList}.`);
  process.exit(1);
}
if (templateFlag === '') {
  console.error(`\nError: --template requires a value: ${templateList}.`);
  process.exit(1);
}

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
    return { projectName, reactCompat, cssApproach, template: templateFlag || 'spa' };
  }

  const prompter = createPrompter();

  console.log('\n  create-what - scaffold a What Framework project\n');

  if (!projectName) {
    projectName = (await prompter.ask('  Project name: ')).trim() || 'my-what-app';
  }

  const template = templateFlag || await prompter.select('Template:', [
    { label: 'SPA (client-side single-page app)', value: 'spa' },
    { label: 'Full-stack (SSR + file routes + loaders + actions + ISR)', value: 'fullstack' },
    { label: 'Static site + islands (JSX pages prerendered to HTML, interactive islands)', value: 'islands' },
  ]);

  // The React-compat and CSS options configure the SPA's compiler pipeline.
  // The full-stack template is buildless and the islands template renders
  // every page on the server, so neither applies to them.
  if (template === 'spa') {
    reactCompat = await prompter.confirm('Add React library support? (what-react)');

    cssApproach = await prompter.select('CSS approach:', [
      { label: 'None (vanilla CSS)', value: 'none' },
      { label: 'Tailwind CSS v4', value: 'tailwind' },
      { label: 'StyleX', value: 'stylex' },
    ]);
  }

  prompter.close();

  return { projectName, reactCompat, cssApproach, template };
}

// ---------------------------------------------------------------------------
// File generators
// ---------------------------------------------------------------------------

function generatePackageJson(packageName, { reactCompat, cssApproach, template }) {
  const deps = {
    'what-framework': whatVersionRange,
  };

  // Full-stack apps are buildless: server.js does SSR + ISR and serves the
  // client entry as native ES modules, so there is no Vite/compiler toolchain.
  // `npm run dev` runs the real app with auto-restart on change.
  // `what-devtools` is the browser bridge: without it the MCP server has nothing
  // to talk to and every live tool reports no browser. In the SPA template the
  // what-devtools-mcp Vite plugin injects it. The full-stack template is
  // buildless and has no plugin to do the injecting, but it still needs the
  // package present: server.js serves it over the import map in dev, the same
  // way it already serves what-framework and what-core. Shipping the template
  // with .mcp.json, .cursor/mcp.json and an MCP-promising CLAUDE.md while
  // omitting the one package that makes any of it work is the worst combination,
  // because the agent is primed to call tools that cannot answer.
  // The islands template renders every page on the server, so its JSX goes
  // through What's automatic runtime (plain h() calls, which Vite's own JSX
  // transform emits) rather than what-compiler, whose output is client-only.
  const devDeps = template === 'fullstack'
    ? {
        'what-devtools': whatVersionRange,
        'what-devtools-mcp': whatVersionRange,
        eslint: '^9.0.0',
        'eslint-plugin-what': whatVersionRange,
        typescript: '^5.6.0',
      }
    : template === 'islands'
      ? {
          vite: '^6.0.0',
          'what-devtools': whatVersionRange,
          'what-devtools-mcp': whatVersionRange,
          eslint: '^9.0.0',
          'eslint-plugin-what': whatVersionRange,
          typescript: '^5.6.0',
        }
      : {
          vite: '^6.0.0',
          'what-compiler': whatVersionRange,
          'what-devtools': whatVersionRange,
          'what-devtools-mcp': whatVersionRange,
          '@babel/core': '^7.23.0',
          eslint: '^9.0.0',
          'eslint-plugin-what': whatVersionRange,
          typescript: '^5.6.0',
        };

  const scripts = template === 'fullstack'
    ? { dev: 'node --watch server.js', start: 'node server.js', lint: 'eslint .', typecheck: 'tsc --noEmit' }
    : template === 'islands'
      ? { dev: 'vite', build: 'node build.js', preview: 'vite preview', lint: 'eslint .', typecheck: 'tsc --noEmit' }
      : { dev: 'vite', build: 'vite build', preview: 'vite preview', lint: 'eslint .', typecheck: 'tsc --noEmit' };
  if (template === 'fullstack') {
    deps['what-isr'] = whatVersionRange;
  }

  if (reactCompat) {
    deps['what-react'] = whatVersionRange;
    deps['what-core'] = whatVersionRange;
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
    name: packageName,
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts,
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

  // MCP DevTools — auto-injects devtools client in dev mode for AI agent debugging
  imports.push(`import whatDevTools from 'what-devtools-mcp/vite-plugin';`);
  plugins.push('whatDevTools()');

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

function generateIndexHtml(packageName) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${packageName}</title>
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
  return `import { mount, signal } from 'what-framework';

function App() {
  const count = signal(0);

  return (
    <main className="app-shell">
      <h1>What Framework</h1>
      <p>Compiler-first JSX, fine-grained signals.</p>

      <section className="counter">
        <button onClick={() => count(c => c - 1)}>-</button>
        <output>{count()}</output>
        <button onClick={() => count(c => c + 1)}>+</button>
      </section>
    </main>
  );
}

mount(<App />, '#app');
`;
}

function generateMainWithTailwind() {
  return `import { mount, signal } from 'what-framework';

function App() {
  const count = signal(0);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 shadow-lg">
        <h1 className="text-2xl font-bold text-slate-900">What Framework</h1>
        <p className="mt-1 text-slate-500">Compiler-first JSX + Tailwind CSS.</p>

        <section className="mt-6 inline-flex items-center gap-3">
          <button
            className="w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-900 hover:border-blue-600 cursor-pointer"
            onClick={() => count(c => c - 1)}
          >
            -
          </button>
          <output className="min-w-[2ch] text-center font-bold">{count()}</output>
          <button
            className="w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-900 hover:border-blue-600 cursor-pointer"
            onClick={() => count(c => c + 1)}
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
  return `import { mount, signal } from 'what-framework';
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
  const count = signal(0);

  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.shell)}>
        <h1 {...stylex.props(styles.heading)}>What Framework</h1>
        <p {...stylex.props(styles.subtitle)}>Compiler-first JSX + StyleX.</p>

        <section {...stylex.props(styles.counter)}>
          <button {...stylex.props(styles.button)} onClick={() => count(c => c - 1)}>-</button>
          <output {...stylex.props(styles.output)}>{count()}</output>
          <button {...stylex.props(styles.button)} onClick={() => count(c => c + 1)}>+</button>
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
    return `import { mount, signal } from 'what-framework';
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
  const count = signal(0);

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 shadow-lg">
        <h1 className="text-2xl font-bold text-slate-900">What Framework</h1>
        <p className="mt-1 text-slate-500">React compat + Tailwind CSS.</p>

        <section className="mt-6 inline-flex items-center gap-3">
          <button
            className="w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-900 hover:border-blue-600 cursor-pointer"
            onClick={() => count(c => c - 1)}
          >
            -
          </button>
          <output className="min-w-[2ch] text-center font-bold">{count()}</output>
          <button
            className="w-9 h-9 rounded-lg border border-slate-300 bg-white text-slate-900 hover:border-blue-600 cursor-pointer"
            onClick={() => count(c => c + 1)}
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
    return `import { mount, signal } from 'what-framework';
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
  const count = signal(0);

  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.shell)}>
        <h1 {...stylex.props(styles.heading)}>What Framework</h1>
        <p {...stylex.props(styles.subtitle)}>React compat + StyleX.</p>

        <section {...stylex.props(styles.counter)}>
          <button {...stylex.props(styles.button)} onClick={() => count(c => c - 1)}>-</button>
          <output {...stylex.props(styles.output)}>{count()}</output>
          <button {...stylex.props(styles.button)} onClick={() => count(c => c + 1)}>+</button>
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
  return `import { mount, signal } from 'what-framework';
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
  const count = signal(0);

  return (
    <main className="app-shell">
      <h1>What Framework</h1>
      <p>React compat enabled — use React libraries with signals.</p>

      <section className="counter">
        <button onClick={() => count(c => c - 1)}>-</button>
        <output>{count()}</output>
        <button onClick={() => count(c => c + 1)}>+</button>
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

function generateReadme(packageName, { reactCompat, cssApproach, template }) {
  let notes = template === 'fullstack'
    ? `- Canonical package name is \`what-framework\`.
- Pages are authored with \`h()\` in plain .js so they run isomorphically (Node
  SSR + browser hydration) with no compile step.
- Event handlers accept both \`onClick\` and \`onclick\`.
- Lint with \`npm run lint\` (eslint-plugin-what).`
    : `- Canonical package name is \`what-framework\`.
- Uses the What compiler for JSX transforms and automatic reactivity.
- Vite is preconfigured; use \`npm run dev/build/preview\`.
- Event handlers accept both \`onClick\` and \`onclick\`; docs and templates use \`onClick\`.
- Lint with \`npm run lint\` (eslint-plugin-what).
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

  if (template === 'islands') {
    return `# ${packageName}

A static What Framework site. Pages are JSX, rendered to plain HTML at build
time, and only the interactive parts (islands) ship JavaScript.

## Run

\`\`\`bash
npm install
npm run dev       # renders each page on request -> http://localhost:5173
npm run build     # writes dist/<page>/index.html plus the island bundle
npm run preview   # serves dist/ the way a static host would
\`\`\`

\`dist/\` is plain files, so any static host can serve it.

## Structure

- \`src/pages/\`: one component per page. \`Home.jsx\` holds the island;
  \`About.jsx\` has none, so it runs no framework code in the browser.
- \`src/components/Layout.jsx\`: the shared header, footer and page title.
- \`src/islands/Counter.jsx\`: the interactive island. Its HTML is in the page
  before any script runs; the browser then hydrates it in place.
- \`src/entry-server.js\`: the route table and the document shell. The dev
  server renders from it on every request, and \`build.js\` renders every route
  from it once.
- \`src/entry-client.js\`: the one script every page loads. When the page has
  an island it registers each one and calls \`hydrateIslands()\`; each island
  is fetched when its trigger fires. A page without islands runs nothing.
- \`vite.config.js\`: the JSX setup and the dev-server page renderer.
- \`build.js\`: builds the client bundle, builds the server half, then writes
  every route with \`exportStatic()\`.

## Adding things

- **A page:** create \`src/pages/Pricing.jsx\` and add a row for it to \`routes\`
  in \`src/entry-server.js\`.
- **An island:** create it in \`src/islands/\`, register it by name in
  \`src/entry-client.js\`, and place it in a page inside
  \`<Island name="..." mode="...">\` with the component as its child, so its
  HTML is server-rendered.

## Notes

- JSX here uses What's automatic runtime (\`jsxImportSource: "what-framework"\`),
  the setup that renders on the server. There is no compiler auto-wrapping, so
  reactive text is written as a function: \`{() => count()}\`.
- An island's \`mode\` decides when it hydrates: \`load\`, \`idle\`, \`visible\`,
  \`action\` (first interaction), \`media\`, or \`static\` (never).
- Lint with \`npm run lint\` (eslint-plugin-what).
`;
  }

  if (template === 'fullstack') {
    return `# ${packageName}

A full-stack What Framework app: file-routed SSR, server loaders, server
actions, client hydration, and origin-first ISR (stale-while-revalidate +
on-demand revalidation + poll regeneration) — works on any host, no CDN
required. Buildless: the server serves the client entry and the framework as
native ES modules, so there is no bundle step.

## Run

\`\`\`bash
npm install
npm run dev      # SSR server with auto-restart on change → http://localhost:3000
npm start        # same server, no watcher (production entry point)
\`\`\`

In production, set \`WHAT_REVALIDATE_SECRET\` (the server refuses to start
without it when \`NODE_ENV=production\`):

\`\`\`bash
WHAT_REVALIDATE_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))") \\
NODE_ENV=production npm start
\`\`\`

## Structure

- \`src/pages/*\` — pages. Each may export \`page\` (route config), \`loader\` (server
  data), \`getStaticPaths\` (pre-render), and a default component.
- \`src/actions/*\` — server actions (mutations), served at \`/__what_action\`. Call
  \`revalidatePath\`/\`revalidateTag\` after a mutation to purge the ISR cache.
- \`src/routes.js\` — the route table (loaders/getStaticPaths/page bound per route).
- \`src/entry-client.js\` — client hydration entry: re-renders the matched page
  with the server's loader data (\`#__what_data\`) and attaches interactivity.
- \`server.js\` — Node adapter + ISR engine + revalidate webhook + poll scheduler
  + static serving. Static serving is deny-by-default: only allowlisted client
  files (\`src/entry-client.js\`, \`src/styles.css\`, \`src/pages/\`,
  \`src/components/\`, framework modules, \`public/\`) are served over HTTP —
  server-only code (\`src/db.js\`, \`src/actions/\`, \`src/routes.js\`) returns 404.
- \`what.config.js\` — deploy adapter + ISR defaults.

The \`/new\` form works without JavaScript: it SSRs hidden \`_action\`,
\`what-csrf-token\` and \`_redirect\` fields, so a plain form-encoded POST to
\`/__what_action\` dispatches the action and redirects. With JavaScript,
\`src/entry-client.js\` upgrades it to a JSON fetch (no full-page reload).
Unknown posts (\`/blog/nope\`) return a real 404 and are never ISR-cached.

### ISR cheat-sheet

- \`page = { mode: 'static', revalidate: 60 }\` → cached, regenerated in the
  background after 60s (stale-while-revalidate). Check the \`X-What-Cache\`
  response header: MISS on first hit, HIT after.
- \`page = { mode: 'server' }\` → always fresh, never cached.
- \`revalidatePath('/')\` / \`revalidateTag('posts')\` → on-demand purge.
- \`POST /__what_revalidate\` with \`WHAT_REVALIDATE_SECRET\` → CMS-triggered purge.

## Notes

${notes}
`;
  }

  return `# ${packageName}

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
// Full-stack template — file-routed SSR pages, server loaders, getStaticPaths,
// origin-first ISR, and a server action that revalidates the cache. Authored
// with h() in plain .js so it runs with `node server.js` (no build step) while
// `npm run dev` still serves the client. Mirrors examples/blog (proven by its
// e2e suite). The full loop: SSR → loader → ISR (MISS→HIT) → action → revalidate.
// ---------------------------------------------------------------------------
function generateFullstackFiles(root, packageName) {
  mkdirSync(resolve(root, 'src', 'pages'), { recursive: true });
  mkdirSync(resolve(root, 'src', 'actions'), { recursive: true });

  // Tiny in-memory "database". Swap for SQLite/Postgres — the loader/action
  // contract is identical.
  writeFileSync(resolve(root, 'src', 'db.js'), `// In-memory demo data. A real app would use SQLite/Postgres; the loader and
// action contracts are identical either way.

const posts = [
  { slug: 'hello-world', title: 'Hello, World', body: 'The first post.', createdAt: 1 },
  { slug: 'why-signals', title: 'Why Signals', body: 'Fine-grained reactivity, no virtual DOM, components run once.', createdAt: 2 },
];

export function listPosts() {
  return [...posts].sort((a, b) => b.createdAt - a.createdAt);
}

export function getPost(slug) {
  return posts.find((p) => p.slug === slug) || null;
}

export function createPost({ title, body }) {
  const slug = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const post = { slug, title, body, createdAt: Date.now() };
  posts.push(post);
  return post;
}
`);

  // Server action: mutate, then revalidate the cached pages it affects.
  writeFileSync(resolve(root, 'src', 'actions', 'posts.js'), `// Server action: create a post, then revalidate the cached home listing.
// revalidatePath purges the origin ISR cache (and any CDN) so the new post
// appears immediately on the next request.

import { action, revalidatePath } from 'what-framework/server';
import { createPost } from '../db.js';

export const createPostAction = action(
  async ({ title, body }) => {
    const post = createPost({ title, body });
    return { ok: true, slug: post.slug };
  },
  { id: 'createPost', revalidate: ['/'] } // purge the home listing on success
);
`);

  // Home page — static + ISR, lists posts via a loader, plus a hydrated
  // counter that proves the client entry attaches interactivity.
  writeFileSync(resolve(root, 'src', 'pages', 'home.js'), `// Home page.
//   export const page   -> route config (JSON-safe: mode, revalidate, tags)
//   export const loader -> runs on the server before render; result -> loaderData
//   export default      -> the page component (runs once, no re-renders)
//
// This module is isomorphic: the server renders it to HTML, then
// src/entry-client.js hydrates the same component in the browser (reusing the
// server DOM and attaching the onclick handler + reactive text below).
// Server-only code (the database) is imported lazily INSIDE the loader, which
// only ever runs on the server — so the browser never requests /src/db.js
// (and server.js refuses to serve it anyway).

import { h, Head, signal, useLoaderData } from 'what-framework';

export const page = { mode: 'static', revalidate: 60, tags: ['posts'] };

export const loader = async () => {
  const { listPosts } = await import('../db.js'); // server-only
  return { posts: listPosts() };
};

export default function Home() {
  const { posts } = useLoaderData();
  const likes = signal(0, 'likes');
  return h('main', { class: 'container' },
    h(Head, {
      title: '${packageName}',
      meta: [{ name: 'description', content: 'A full-stack app built with What Framework' }],
    }),
    h('h1', {}, '${packageName}'),
    h('p', {}, 'Server-rendered, ISR-cached, hydrated on the client.'),
    h('section', { class: 'like-demo' },
      h('button', { onclick: () => likes(n => n + 1) }, 'Like'),
      h('output', {}, () => String(likes())),
      h('span', { class: 'hint' }, 'hydrated — this button works in the browser')
    ),
    h('ul', {}, posts.map((p) =>
      h('li', { key: p.slug }, h('a', { href: \`/blog/\${p.slug}\` }, p.title))
    )),
    h('p', {}, h('a', { href: '/new' }, '+ New post'))
  );
}
`);

  // Dynamic /blog/[slug] — loader + getStaticPaths + ISR + per-post <Head>.
  writeFileSync(resolve(root, 'src', 'pages', 'post.js'), `// Dynamic post page. getStaticPaths pre-renders known slugs at build; unknown
// slugs render on first hit (fallback: 'blocking') and are then cached.
// The database import lives inside the loader/getStaticPaths (server-only),
// keeping /src/db.js out of the browser. A missing post sets notFound: true,
// which server.js turns into a real 404 status that is never ISR-cached.

import { h, Head, useLoaderData } from 'what-framework';

export const page = { mode: 'static', revalidate: 60, tags: ['posts'] };

export const loader = async ({ params }) => {
  const { getPost } = await import('../db.js'); // server-only
  const post = getPost(params.slug);
  return { post, notFound: !post };
};

export async function getStaticPaths() {
  const { listPosts } = await import('../db.js'); // server-only
  return {
    paths: listPosts().map((p) => ({ params: { slug: p.slug } })),
    fallback: 'blocking',
  };
}

export default function Post() {
  const { post } = useLoaderData();
  if (!post) return h('main', { class: 'container' }, h('h1', {}, 'Not found'));
  return h('main', { class: 'container' },
    h(Head, {
      title: \`\${post.title} — ${packageName}\`,
      meta: [{ property: 'og:title', content: post.title }],
    }),
    h('article', {}, h('h1', {}, post.title), h('p', {}, post.body)),
    h('p', {}, h('a', { href: '/' }, '← Back'))
  );
}
`);

  // /new — mode:'server' (never cached), posts to the createPost action.
  writeFileSync(resolve(root, 'src', 'pages', 'new.js'), `// New-post form. mode:'server' so it's always fresh — which also means the
// per-user CSRF token can be SSR'd into the form (never into shared cache).
//
// The form works two ways:
//   - No JS: a plain form-encoded POST to /__what_action. The hidden fields
//     carry the action id (_action), the double-submit CSRF token
//     (what-csrf-token) and the post-submit redirect (_redirect).
//   - With JS: src/entry-client.js intercepts submit and posts JSON with the
//     X-What-Action header (the action protocol), then navigates to the post.

import { h, Head, useLoaderData } from 'what-framework';

export const page = { mode: 'server' };

// server.js passes the per-request CSRF token (the same one the framework
// Set-Cookies and embeds as the <meta> tag) into loaders; fall back to the
// visitor's existing cookie. Rendered into the hidden field below so the
// no-JS form post passes the double-submit check.
export const loader = ({ request, csrfToken }) => {
  if (csrfToken) return { csrfToken };
  const cookie = request && request.headers && typeof request.headers.get === 'function'
    ? request.headers.get('cookie')
    : '';
  const match = cookie ? cookie.match(/(?:^|;\\s*)what-csrf=([^;]+)/) : null;
  return { csrfToken: match ? decodeURIComponent(match[1]) : '' };
};

export default function NewPost() {
  const { csrfToken } = useLoaderData();
  return h('main', { class: 'container' },
    h(Head, { title: 'New post — ${packageName}' }),
    h('h1', {}, 'New post'),
    h('form', { method: 'post', action: '/__what_action', 'data-action': 'createPost' },
      h('input', { type: 'hidden', name: '_action', value: 'createPost' }),
      h('input', { type: 'hidden', name: 'what-csrf-token', value: csrfToken || '' }),
      h('input', { type: 'hidden', name: '_redirect', value: '/' }),
      h('input', { name: 'title', placeholder: 'Title', required: true }),
      h('textarea', { name: 'body', placeholder: 'Write something…', required: true }),
      h('button', { type: 'submit' }, 'Publish')
    ),
    h('p', {}, h('a', { href: '/' }, '← Back'))
  );
}
`);

  // Route table. In a JSX app the vite plugin generates this from src/pages/**;
  // here it's hand-written so the app runs with plain \`node server.js\`.
  writeFileSync(resolve(root, 'src', 'routes.js'), `// Each entry carries the page's default component plus its live
// loader/getStaticPaths/page bindings.

import Home, { loader as homeLoader, page as homePage } from './pages/home.js';
import Post, { loader as postLoader, getStaticPaths as postPaths, page as postPage } from './pages/post.js';
import NewPost, { loader as newLoader, page as newPage } from './pages/new.js';

// Importing the action registers it so /__what_action can dispatch it.
import './actions/posts.js';

export const routes = [
  { path: '/', component: Home, loader: homeLoader, page: homePage, mode: homePage.mode },
  { path: '/blog/:slug', component: Post, loader: postLoader, getStaticPaths: postPaths, page: postPage, mode: postPage.mode },
  { path: '/new', component: NewPost, loader: newLoader, page: newPage, mode: newPage.mode },
];
`);

  // Client hydration entry — loaded by the SSR document (see server.js). Reuses
  // the server-rendered DOM and attaches interactivity. No bundler involved:
  // the browser resolves 'what-framework' through the import map server.js
  // injects, and ./pages/* are served as plain ES modules.
  writeFileSync(resolve(root, 'src', 'entry-client.js'), `// Client hydration entry.
// The SSR document loads this as a native ES module. It matches the current
// URL to a page component, re-runs it with the server's loader data (pages
// call useLoaderData(), which reads the #__what_data payload the server
// embedded), and hydrate() walks the existing server-rendered DOM — attaching
// event handlers and reactive bindings instead of recreating elements.
//
// NOTE: import page modules directly, never ./routes.js — the route table also
// imports the server actions, which pull in Node-only modules.

import { h, hydrate } from 'what-framework';
import Home from './pages/home.js';
import Post from './pages/post.js';
import NewPost from './pages/new.js';

function matchPage(pathname) {
  if (pathname === '/') return h(Home, {});
  const post = pathname.match(/^\\/blog\\/([^/]+)\\/?$/);
  if (post) return h(Post, { slug: decodeURIComponent(post[1]) });
  if (pathname === '/new') return h(NewPost, {});
  return null;
}

const vnode = matchPage(location.pathname);
if (vnode) hydrate(vnode, document.body);

// Dev-only devtools bridge. This is what makes the \\\`what_*\\\` MCP tools in
// CLAUDE.md able to see this running app: without it every live tool reports
// "no browser connected". The SPA template gets this from the what-devtools-mcp
// Vite plugin; this template is buildless, so it does the same three steps by
// hand. server.js sets __WHAT_DEV__ and __WHAT_MCP__ in dev only, and the
// imports are dynamic, so a production page never fetches either module.
if (globalThis.__WHAT_DEV__) {
  Promise.all([
    import('what-core'),
    import('what-devtools'),
  ]).then(async ([core, devtools]) => {
    // installDevTools alone makes the app inspectable in the browser. Connecting
    // to the MCP bridge is a second, optional step: it only happens once
    // \\\`npx what-devtools-mcp\\\` has run and written a token, so an app started
    // without the MCP server makes no connection attempts and logs nothing.
    devtools.installDevTools(core);
    if (globalThis.__WHAT_MCP__) {
      const mcp = await import('what-devtools-mcp/client');
      mcp.connectDevToolsMCP(globalThis.__WHAT_MCP__);
    }
  }).catch((err) => {
    console.warn('[what] devtools unavailable:', err.message);
  });
}

// Progressive enhancement for server-action forms: submit as JSON to
// /__what_action with the X-What-Action header (the served-action protocol),
// then navigate to the result. The CSRF token comes from the double-submit
// cookie the server sets on every HTML response (or the meta tag on
// uncached pages) — same lookup the framework's own action() client uses.
function csrfToken() {
  const meta = document.querySelector('meta[name="what-csrf-token"]');
  if (meta) return meta.getAttribute('content');
  const match = document.cookie.match(/(?:^|;\\s*)what-csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

for (const form of document.querySelectorAll('form[data-action]')) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const args = Object.fromEntries(new FormData(form));
    // The hidden fields exist for the no-JS form-post fallback; the framework
    // consumes them server-side on that path. Strip them from the JSON args.
    for (const k of ['_action', '_csrf', '_redirect', 'what-csrf-token', 'data-action']) delete args[k];
    const headers = { 'content-type': 'application/json', 'x-what-action': form.dataset.action };
    const token = csrfToken();
    if (token) headers['x-csrf-token'] = token;
    const res = await fetch('/__what_action', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ args: [args] }),
    });
    const result = await res.json().catch(() => ({}));
    if (res.ok) {
      location.href = result.slug ? \`/blog/\${result.slug}\` : '/';
    } else {
      console.error('[what] action failed:', result.message || res.status);
    }
  });
}
`);

  // Stylesheet for the SSR pages (linked from the document head in server.js).
  writeFileSync(resolve(root, 'src', 'styles.css'), `:root {
  color-scheme: light;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: #f4f6fb;
  color: #0f172a;
}

.container {
  max-width: 640px;
  margin: 0 auto;
  padding: 2.5rem 1.25rem;
}

a {
  color: #2563eb;
}

button {
  border: 1px solid #9aa7bb;
  background: #ffffff;
  color: #0f172a;
  padding: 0.4rem 0.9rem;
  border-radius: 10px;
  cursor: pointer;
}

button:hover {
  border-color: #2563eb;
}

.like-demo {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0.5rem 0 1rem;
}

.like-demo output {
  min-width: 2ch;
  text-align: center;
  font-weight: 700;
}

.like-demo .hint {
  color: #64748b;
  font-size: 0.875rem;
}

form {
  display: grid;
  gap: 0.75rem;
  max-width: 420px;
}

input,
textarea {
  padding: 0.5rem 0.75rem;
  border: 1px solid #9aa7bb;
  border-radius: 10px;
  font: inherit;
}
`);

  // Full-stack server: Node adapter + origin-first ISR + revalidate webhook +
  // poll scheduler + static serving for the buildless client (native ESM).
  writeFileSync(resolve(root, 'server.js'), `// Full-stack server. \`npm run dev\` (auto-restart) or \`node server.js\`
// → http://localhost:3000. Wires the Node adapter + origin-first ISR engine +
// on-demand revalidation webhook + poll scheduler. No CDN — and no bundler —
// required: the client entry and the framework are served as native ES modules
// (see the import map below).

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, statSync, createReadStream, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler, renderDocument, toNodeListener } from 'what-framework/server';
import {
  createCacheEngine,
  createMemoryStore,
  createRevalidateWebhook,
  createScheduler,
} from 'what-isr';
import { routes } from './src/routes.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

// Secret for the on-demand revalidation webhook (POST /__what_revalidate).
// Required in production; auto-generated per run in dev so there is never a
// shared default secret.
let REVALIDATE_SECRET = process.env.WHAT_REVALIDATE_SECRET;
if (!REVALIDATE_SECRET) {
  if (isProd) {
    console.error(
      '[${packageName}] WHAT_REVALIDATE_SECRET must be set in production.\\n' +
      \"  Generate one:  node -e \\\"console.log(require('node:crypto').randomBytes(24).toString('hex'))\\\"\"
    );
    process.exit(1);
  }
  REVALIDATE_SECRET = randomBytes(24).toString('hex');
  console.log(\`[dev] WHAT_REVALIDATE_SECRET not set — generated for this run: \${REVALIDATE_SECRET}\`);
}

// Origin ISR cache. Swap createMemoryStore() for createFilesystemStore({dir})
// to survive restarts, or createRedisStore({client}) for multi-instance.
// \`render\` powers scheduled regeneration (renderRoute is defined below;
// function declarations hoist, so the reference is valid here).
const cache = createCacheEngine({ store: createMemoryStore(), render: renderRoute });

// Non-200 renders (soft-404s like /blog/nonexistent) must never be ISR-cached —
// a cached "Not found" would shadow a post created later and poison SEO. The
// engine skips storing them; this wrapper also drops any stored non-200 entry
// and forces the response uncacheable (belt and suspenders).
const appCache = {
  ...cache,
  async handle(routeMatch, render) {
    let result = await cache.handle(routeMatch, render);
    if (result && result.status && result.status !== 200) {
      try { await cache.store.delete(cache.keyFor(routeMatch)); } catch { /* best effort */ }
      const headers = { ...(result.headers || {}) };
      delete headers['Cache-Control'];
      delete headers['cache-control'];
      headers['Cache-Control'] = 'private, no-store';
      result = { ...result, headers };
    }
    return result;
  },
};

// Keep the home listing warm every 5 minutes regardless of traffic.
const scheduler = createScheduler(cache);
scheduler.register(
  { path: '/', query: {}, params: {}, config: routes[0].page, route: routes[0] },
  { intervalMs: 5 * 60 * 1000 }
);

// The browser loads /src/entry-client.js as a native ES module; this import
// map resolves its bare imports. Sources are served from node_modules below.
const importMap = {
  imports: {
    'what-framework': '/node_modules/what-framework/src/index.js',
    'what-core': '/node_modules/what-core/src/index.js',
    // Dev only. This template is buildless, so there is no Vite plugin to inject
    // the devtools bridge the way the SPA template gets it. Mapping the two
    // specifiers here (and serving them below) is all it takes for the MCP
    // \`what_*\` tools to see this app: entry-client.js dynamically imports them
    // behind the __WHAT_DEV__ flag, so production never fetches either module.
    ...(isProd ? {} : {
      'what-devtools': '/node_modules/what-devtools/src/index.js',
      'what-devtools-mcp/client': '/node_modules/what-devtools-mcp/src/client.js',
    }),
  },
};

// The MCP bridge writes its token here when \`npx what-devtools-mcp\` starts.
// Read per render, not once at boot, so starting the bridge after the server is
// already up only costs a page reload.
//
// The token is passed INLINE rather than via the Vite plugin's same-origin
// discovery endpoint, which this server does not implement. That is deliberate:
// the client only probes for a bridge when it has a token or a discovery URL, so
// an app running without the MCP server makes no requests and logs nothing at
// all. Handing it a discovery URL that 404s would put a red line in every
// developer's console on every page load.
function mcpToken() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'node_modules', '.cache', 'what-devtools-mcp', 'token'), 'utf8')).token || '';
  } catch {
    return '';
  }
}

function devToolsHead() {
  if (isProd) return '';
  const token = mcpToken();
  if (!token) return '<script>globalThis.__WHAT_DEV__=true</script>';
  return \`<script>globalThis.__WHAT_DEV__=true;globalThis.__WHAT_MCP__=\${JSON.stringify({ port: 9229, token })}</script>\`;
}

const documentOptions = {
  clientEntry: '/src/entry-client.js',
  // A getter, so devToolsHead() re-reads the token on every render.
  get head() {
    return \`<script type="importmap">\${JSON.stringify(importMap)}</script>\` +
      devToolsHead() +
      '<link rel="stylesheet" href="/src/styles.css">' +
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';
  },
};

// Render a matched route. Mirrors the framework default renderer, plus:
//   - passes csrfToken through to loaders (so /new can SSR the no-JS form token)
//   - honors a loader's \`notFound: true\` with a real 404 status (the appCache
//     wrapper above keeps those responses out of the ISR cache)
async function renderRoute(routeMatch) {
  const { route, params, query, request, csrfToken } = routeMatch;
  const reqCtx = { params, query, request, csrfToken };
  const loaderData = typeof route.loader === 'function' ? await route.loader(reqCtx) : undefined;
  const notFound = !!(loaderData && loaderData.notFound);
  const pageModule = { default: route.component, loader: () => loaderData };
  const opts = csrfToken ? { ...documentOptions, csrfToken } : documentOptions;
  const html = await renderDocument(pageModule, reqCtx, opts);
  return {
    html,
    status: notFound ? 404 : 200,
    tags: (routeMatch.config && routeMatch.config.tags) || [],
    path: routeMatch.path,
  };
}

export function createHandler() {
  return createRequestHandler({
    routes,
    cache: appCache,
    render: renderRoute,
    revalidateWebhook: createRevalidateWebhook(cache, { secret: REVALIDATE_SECRET }),
    document: documentOptions,
  });
}

// --- Static files (client entry, page modules, framework sources, public/) ---

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

// Deny-by-default static serving: ONLY the allowlisted client files below are
// served from the project root. Server-only modules — src/db.js, src/actions/**
// and src/routes.js — are importable by Node but 404 over HTTP, so DB code and
// mutation logic never leak to the browser. When you add new client-side files
// outside these locations, add them here explicitly.
const SERVED_FILES = new Set(['/src/entry-client.js', '/src/styles.css']);
const SERVED_PREFIXES = [
  '/src/pages/',                  // page modules (hydrated by entry-client)
  '/src/components/',             // client-shared UI (create as needed)
  '/node_modules/what-framework/',
  '/node_modules/what-core/',
  // Dev only: the devtools bridge entry-client imports when __WHAT_DEV__ is set.
  // Gated on isProd so a production deploy never serves dev tooling.
  ...(isProd ? [] : ['/node_modules/what-devtools/', '/node_modules/what-devtools-mcp/']),
];

function resolveStaticFile(pathname) {
  if (pathname.includes('..') || pathname.includes('\0')) return null;
  const allowed = SERVED_FILES.has(pathname) || SERVED_PREFIXES.some((p) => pathname.startsWith(p));
  const file = allowed
    ? resolve(join(ROOT, pathname))
    : resolve(join(ROOT, 'public', pathname));
  if (!file.startsWith(resolve(ROOT))) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

function requestPathname(reqUrl) {
  try {
    return decodeURIComponent(new URL(reqUrl || '/', 'http://localhost').pathname);
  } catch {
    return null;
  }
}

// --- Start (node server.js / npm run dev), not when imported by tests ---

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const app = toNodeListener(createHandler());

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const pathname = requestPathname(req.url);
      if (!pathname) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('Bad Request');
      }
      const file = resolveStaticFile(pathname);
      if (file) {
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
        if (req.method === 'HEAD') return res.end();
        return createReadStream(file).pipe(res);
      }
    }
    app(req, res);
  });

  scheduler.start();
  const stop = () => { try { scheduler.stop(); } catch {} server.close(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(\`${packageName} → http://localhost:\${port}\`));
}
`);

  // App config — the CLI reads this to pick a deploy adapter + ISR defaults.
  writeFileSync(resolve(root, 'what.config.js'), `// What Framework app config. \`what build\` / \`what start\` read this to pick a
// deploy adapter and ISR defaults.
export default {
  adapter: 'node', // 'node' | 'vercel' | 'cloudflare' | 'static'
  isr: {
    store: 'memory', // 'memory' | 'filesystem' | 'redis'
    defaultRevalidate: 60,
  },
};
`);
}

// ---------------------------------------------------------------------------
// Islands template: JSX pages prerendered to static HTML, with interactive
// islands hydrated by what-server's island registry. Every page is rendered on
// the server, so JSX goes through What's automatic runtime (h() calls), which
// renders with renderDocument() and hydrates in place in the browser.
// ---------------------------------------------------------------------------
function generateIslandsFiles(root, packageName) {
  for (const dir of ['pages', 'components', 'islands']) {
    mkdirSync(resolve(root, 'src', dir), { recursive: true });
  }

  writeFileSync(resolve(root, 'vite.config.js'), `import { existsSync } from 'node:fs';
import { extname, join, posix, resolve } from 'node:path';
import { defineConfig } from 'vite';
import whatDevTools from 'what-devtools-mcp/vite-plugin';

// Every page is rendered to HTML by the server half (src/entry-server.js), so
// JSX uses What's automatic runtime. It lowers to h() calls, which render on the
// server and hydrate in place in the browser. (what-compiler's output is
// client-only, which is why this template does not use it.)
export default defineConfig({
  appType: 'custom',
  esbuild: { jsx: 'automatic', jsxImportSource: 'what-framework' },
  plugins: [staticPages(), whatDevTools()],
  // One copy of the framework: served as ES modules rather than pre-bundled.
  optimizeDeps: {
    entries: ['src/entry-client.js'],
    exclude: ['what-framework', 'what-core', 'what-router', 'what-server'],
  },
  build: {
    manifest: true,
    rollupOptions: {
      input: { client: 'src/entry-client.js', styles: 'src/styles.css' },
    },
  },
});

function staticPages() {
  return {
    name: 'static-pages',
    apply: 'serve',

    // \`npm run dev\`: render each page on request through the same code build.js
    // uses, so the dev server shows exactly the HTML the build writes.
    configureServer(server) {
      // Pages only exist on the server, so an edit reloads the page.
      server.watcher.on('change', (file) => {
        if (/[\\\\/]src[\\\\/]/.test(file)) server.ws.send({ type: 'full-reload' });
      });
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        const { pathname } = new URL(req.url, 'http://localhost');
        // Files and Vite's own endpoints are never pages.
        if (extname(pathname) || pathname.startsWith('/@') || pathname.startsWith('/__')) return next();
        try {
          const { renderRoute } = await server.ssrLoadModule('/src/entry-server.js');
          const html = await renderRoute(pathname, {
            script: '/src/entry-client.js',
            stylesheet: '/src/styles.css',
          });
          if (html == null) return next();
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(await server.transformIndexHtml(req.url, html));
        } catch (error) {
          server.ssrFixStacktrace(error);
          next(error);
        }
      });
    },

    // \`npm run preview\`: serve dist/ the way a static host does, so /about
    // answers with dist/about/index.html.
    configurePreviewServer(server) {
      const outDir = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((req, res, next) => {
        const { pathname } = new URL(req.url, 'http://localhost');
        if (!extname(pathname) && existsSync(join(outDir, pathname, 'index.html'))) {
          req.url = posix.join(pathname, 'index.html');
        }
        next();
      });
    },
  };
}
`);

  writeFileSync(resolve(root, 'build.js'), `// Static build: \`npm run build\`.
//
//   1. Client bundle: the island entry, each island as its own chunk, and the
//      stylesheet, with a manifest naming the hashed files.
//   2. Server bundle of src/entry-server.js (pages and layout).
//   3. exportStatic() renders every route to dist/<path>/index.html, linking
//      the hashed files from step 1.
//
// The output is plain files, so any static host can serve dist/.

import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { exportStatic } from 'what-framework/server';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(root, 'dist');
const ssrDir = resolve(root, '.ssr');

await build({ root, logLevel: 'warn' });
await build({
  root,
  logLevel: 'warn',
  build: {
    ssr: 'src/entry-server.js',
    outDir: ssrDir,
    emptyOutDir: true,
    manifest: false,
    copyPublicDir: false,
    rollupOptions: { input: 'src/entry-server.js' },
  },
});

const manifest = JSON.parse(readFileSync(join(outDir, '.vite', 'manifest.json'), 'utf8'));
const assets = {
  script: '/' + manifest['src/entry-client.js'].file,
  stylesheet: '/' + manifest['src/styles.css'].file,
};

const { routes, documentOptions } = await import(pathToFileURL(join(ssrDir, 'entry-server.js')).href);
const { pages } = await exportStatic({ routes, outDir, documentOptions: documentOptions(assets) });

rmSync(ssrDir, { recursive: true, force: true });
rmSync(join(outDir, '.vite'), { recursive: true, force: true });

for (const page of pages) console.log(\`  \${page === '/' ? '/index.html' : page + '/index.html'}\`);
console.log(\`Built \${pages.length} pages into dist/\`);
`);

  writeFileSync(resolve(root, 'src', 'entry-server.js'), `// The server half of the site: the route table and the document every page is
// rendered into. The dev server (vite.config.js) renders from it on each
// request, and build.js renders every route from it once.

import { renderDocument } from 'what-framework/server';
import Home from './pages/Home.jsx';
import About from './pages/About.jsx';

// \`mode: 'static'\` is what exportStatic() writes to dist/.
export const routes = [
  { path: '/', component: Home, mode: 'static' },
  { path: '/about', component: About, mode: 'static' },
];

// \`assets\` names the client files: source paths in dev, hashed files in a build.
export function documentOptions({ script, stylesheet }) {
  return {
    clientEntry: script,
    head:
      \`<link rel="stylesheet" href="\${stylesheet}">\` +
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
  };
}

export function renderRoute(pathname, assets) {
  const path = pathname.length > 1 ? pathname.replace(/\\/+$/, '') : pathname;
  const route = routes.find((r) => r.path === path);
  if (!route) return null;
  return renderDocument({ default: route.component }, { params: {}, query: {} }, documentOptions(assets));
}
`);

  writeFileSync(resolve(root, 'src', 'entry-client.js'), `// The one script every page loads. Pages are static HTML, so a page without an
// island stops at the check below and runs no framework code at all. A page
// with islands loads the island runtime, which hydrates each island over its
// server-rendered markup. Each island is its own chunk, fetched when its
// \`mode\` says so.
//
// The island helpers live in what-framework/server next to the server-side
// <Island> marker, but they are browser code.

if (document.querySelector('[data-island]')) {
  import('what-framework/server').then(({ island, hydrateIslands }) => {
    island('counter', () => import('./islands/Counter.jsx'));
    hydrateIslands();
  });
}
`);

  writeFileSync(resolve(root, 'src', 'components', 'Layout.jsx'), `import { Head } from 'what-framework';

const SITE_NAME = ${JSON.stringify(packageName)};

// Shared by every page. <Head> sets the page's <title> in the rendered HTML.
export default function Layout({ title, children }) {
  return (
    <div class="site">
      <Head title={\`\${title} | \${SITE_NAME}\`} />
      <header class="site-header">
        <a class="brand" href="/">{SITE_NAME}</a>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
        </nav>
      </header>
      <main>{children}</main>
      <footer class="site-footer">Static HTML, built with What Framework.</footer>
    </div>
  );
}
`);

  writeFileSync(resolve(root, 'src', 'pages', 'Home.jsx'), `import { Island } from 'what-framework/server';
import Layout from '../components/Layout.jsx';
import Counter from '../islands/Counter.jsx';

const counter = { start: 3 };

export default function Home() {
  return (
    <Layout title="Home">
      <h1>A static site with islands</h1>
      <p>
        This page is plain HTML, written at build time. The counter below is an
        island: its markup is in the HTML too, and it is the only part of the
        page that loads JavaScript.
      </p>
      {/* The child is the island's server render. The browser hydrates it in
          place, so the component and its props must match on both sides. */}
      <Island name="counter" mode="visible" props={counter}>
        <Counter {...counter} />
      </Island>
    </Layout>
  );
}
`);

  writeFileSync(resolve(root, 'src', 'pages', 'About.jsx'), `import Layout from '../components/Layout.jsx';

export default function About() {
  return (
    <Layout title="About">
      <h1>About</h1>
      <p>
        This page has no islands, so it runs no framework code in the browser.
      </p>
      <p>
        To add a page, create a component in <code>src/pages/</code> and add a
        row for it to <code>routes</code> in <code>src/entry-server.js</code>.
      </p>
      <p><a href="/">Back to the counter</a></p>
    </Layout>
  );
}
`);

  writeFileSync(resolve(root, 'src', 'islands', 'Counter.jsx'), `import { signal } from 'what-framework';

// An island. It renders on the server as part of the page, then hydrates in the
// browser (see src/entry-client.js). Reactive text is a function, \`{() => ...}\`:
// this template uses the automatic JSX runtime, which does not wrap reads for you.
export default function Counter({ start = 0 }) {
  const count = signal(start, 'count');

  return (
    <div class="counter">
      <button type="button" aria-label="Decrease" onclick={() => count((c) => c - 1)}>-</button>
      <output aria-live="polite">{() => count()}</output>
      <button type="button" aria-label="Increase" onclick={() => count((c) => c + 1)}>+</button>
    </div>
  );
}
`);

  writeFileSync(resolve(root, 'src', 'styles.css'), `:root {
  color-scheme: light;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  line-height: 1.5;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f4f6fb;
  color: #0f172a;
}

.site {
  max-width: 640px;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 3rem;
}

.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #dbe2ee;
}

.site-header nav {
  display: flex;
  gap: 1rem;
}

.brand {
  font-weight: 700;
  color: inherit;
  text-decoration: none;
}

a {
  color: #2563eb;
}

.site-footer {
  margin-top: 3rem;
  color: #64748b;
  font-size: 0.875rem;
}

.counter {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
}

.counter button {
  border: 1px solid #9aa7bb;
  background: #ffffff;
  color: #0f172a;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 10px;
  cursor: pointer;
}

.counter button:hover {
  border-color: #2563eb;
}

.counter output {
  min-width: 2ch;
  text-align: center;
  font-weight: 700;
}
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const options = await gatherOptions();
  const { projectName, reactCompat, cssApproach } = options;

  const root = resolve(process.cwd(), projectName);
  const packageName = basename(root);

  if (existsSync(root)) {
    console.error(`\nError: "${root}" already exists.`);
    process.exit(1);
  }

  mkdirSync(resolve(root, 'src'), { recursive: true });
  mkdirSync(resolve(root, 'public'), { recursive: true });
  // MCP DevTools config — lets AI agents (Claude Code, Cursor, etc.) connect to the running app
  writeFileSync(resolve(root, '.mcp.json'), JSON.stringify({
    mcpServers: {
      'what-devtools-mcp': {
        command: 'npx',
        args: ['what-devtools-mcp'],
      },
    },
  }, null, 2) + '\n');

  const isFullstack = options.template === 'fullstack';
  const isIslands = options.template === 'islands';

  // The templates have different authoring models: the SPA compiles JSX
  // through Vite + what-compiler, the full-stack template is buildless and has
  // neither, and the islands template writes JSX for the automatic runtime.
  // An agent told the wrong one writes code that cannot run, or never updates.
  const authoringNotes = isFullstack
    ? `Components run ONCE. This is the buildless full-stack template: \`server.js\` renders
file routes and serves \`src/\` as native ES modules. There is **no compiler and no JSX**:
write views with \`h()\` and pass \`() => ...\` for anything reactive.

\`\`\`js
h('p', {}, () => \`Count: \${count()}\`)
\`\`\`

Pages live in \`src/pages/\` and export \`page\` (route config), \`loader\` (server data), and a
default component. \`src/db.js\`, \`src/routes.js\` and \`src/actions/\` are server-only: they are
importable by Node but never served to the browser.`
    : isIslands
      ? `Components run ONCE. This is the islands template: every page in \`src/pages/\` is
rendered to static HTML (\`npm run build\` writes \`dist/<page>/index.html\`), and only the
islands in \`src/islands/\` run in the browser. JSX uses What's automatic runtime, NOT
\`what-compiler\`, so nothing is wrapped for you: reactive text must be a function.

\`\`\`jsx
<output>{() => count()}</output>
\`\`\`

To add an island: create it in \`src/islands/\`, register it by name in
\`src/entry-client.js\`, and place it in a page as
\`<Island name="..." mode="..." props={p}><Component {...p} /></Island>\` (the \`Island\` from
\`what-framework/server\`). The child is its server render and must match what the component
renders in the browser. Pages are listed in \`routes\` in \`src/entry-server.js\`.`
      : `Components run ONCE. This is the SPA template: Vite + \`what-compiler\` compile JSX into
fine-grained DOM operations, so write JSX and use \`() => ...\` for reactive text.

\`\`\`jsx
<p>{() => \`Count: \${count()}\`}</p>
\`\`\`
`;

  const mcpIntro = isFullstack
    ? `This project includes MCP devtools that connect to the running app in the browser.
The SPA template gets the bridge from a Vite plugin; this template is buildless, so
\`src/entry-client.js\` imports it directly when \`server.js\` sets \`__WHAT_DEV__\` (dev only).
Run \`npm run dev\`, open the app, then use the live \`what_*\` tools below. \`what_lint\`,
\`what_scaffold\` and \`what_fix\` also work offline with no browser at all.`
    : `This project includes MCP devtools that connect to the running app in the browser.`;

  // CLAUDE.md — agent instructions for Claude Code (also useful for other AI tools)
  writeFileSync(resolve(root, 'CLAUDE.md'), `# ${packageName}

Built with What Framework — signal-based reactivity, components run once.

## Writing Code

\`\`\`js
import { signal, effect, computed, batch, onMount, h, mount } from 'what-framework';

const count = signal(0, 'count');  // state
count()           // read
count(5)          // write
count(c => c + 1) // update

const doubled = computed(() => count() * 2);  // derived
effect(() => console.log(count()));           // side effect
\`\`\`

${authoringNotes}

**Signal scope:** \`signal()\` works anywhere — module scope (shared state), component scope (local state). Components run once, so signal declarations execute exactly once.

## MCP DevTools

${mcpIntro}

### Quick Start (First 5 Minutes)

1. \`what_connection_status\` — am I connected? how big is the app?
2. \`what_diagnose\` — any errors or issues?
3. \`what_page_map\` — what's on the page?
4. \`what_components\` -> \`what_explain\` on a leaf component — deep dive
5. \`what_signals({filter: "name", named_only: true})\` — check key state

### Decision Tree

| I want to... | Use this |
|---|---|
| Get oriented / check connection | \`what_connection_status\` |
| Health check (errors + perf + reactivity) | \`what_diagnose\` |
| Find a component by name | \`what_components {filter}\` |
| Understand one component deeply | \`what_explain {componentId}\` |
| See the component hierarchy | \`what_component_tree\` |
| Check a signal's current value | \`what_signals {filter, named_only: true}\` |
| See all effects and their run counts | \`what_effects {minRunCount}\` |
| Understand why a signal changed | \`what_signal_trace {signalId}\` |
| See what depends on a signal | \`what_dependency_graph {signalId, direction: "downstream"}\` |
| See what an effect depends on | \`what_dependency_graph {effectId, direction: "upstream"}\` |
| Find runtime errors | \`what_errors\` |
| Get component layout/styles (no image) | \`what_look {componentId}\` |
| Get full page structure | \`what_page_map\` |
| Get a visual screenshot | \`what_screenshot {componentId}\` (use after what_look) |
| Inspect raw DOM | \`what_dom_inspect {componentId, depth}\` |
| Find performance issues | \`what_perf {threshold}\` |
| Compare before/after state | \`what_diff_snapshot {action: "save"}\` then \`{action: "diff"}\` |
| Change a signal live | \`what_set_signal {signalId, value}\` |
| Validate code before saving | \`what_lint {code}\` |
| Generate boilerplate | \`what_scaffold {type, name}\` |
| Diagnose an error code | \`what_fix {error}\` |

### Workflows

**Find and inspect a component:**
\`what_components({filter:"Stats"})\` -> get ID -> \`what_explain({componentId: 4})\`

**Debug a signal's reactive graph:**
\`what_signals({filter:"count"})\` -> get ID -> \`what_dependency_graph({signalId: 1, direction: "downstream"})\`

**Before/after comparison:**
\`what_diff_snapshot({action:"save"})\` -> make change -> \`what_diff_snapshot({action:"diff"})\`

**Performance audit:**
\`what_perf({threshold: 3})\` -> \`what_effects({minRunCount: 2})\` -> \`what_dependency_graph({effectId: N})\`

**Visual/layout audit:**
\`what_page_map\` -> \`what_look({componentId: N})\` on key components -> \`what_screenshot\` only if needed

**Disconnected reactivity (UI parts that should update together but don't):**
\`what_dependency_graph({signalId: N, direction: "downstream"})\` -> check ALL expected effects appear. Missing edges = component won't react to that signal.

**Multi-signal interaction (order-of-operations bugs):**
\`what_diff_snapshot(save)\` -> set signal A -> \`diff\` -> save -> set signal B -> \`diff\`. Compare cascades.

**Build & test new features:**
\`what_look\` to match styling -> \`what_scaffold\` for structure -> write code -> \`what_lint\` -> \`what_diff_snapshot(save)\` -> \`what_set_signal\` to simulate trigger -> \`what_diff_snapshot(diff)\` to verify cascade.

**Stale subscription (effect should fire but doesn't):**
If dep graph shows an edge but diff shows 0 re-runs, the effect lost its subscription during a remount. Fix: move effect to module scope or use \`computed()\`.

### Understanding Diagnostics

- **"N signals with no subscribers"** — A signal may be unused or sampled during setup. Reactive text/attribute bindings do use tracked effects; check mounted bindings and dependency edges rather than assuming a separate renderer mechanism.
- **"N effects with no signal dependencies"** — A successful one-shot setup effect can run once without dependencies. Initial runs are reported before a later signal write; lazy computeds remain unevaluated until read.
- **Components with signalCount=0** — Module-scope signals (shared stores) don't appear on any component. Use \`what_signals\` directly.
- **\`<!--fn-->\` in DOM** — Reactive function-child markers. Their tracked effects participate in the dependency graph.

### Key Parameters

| Param | Type | Notes |
|---|---|---|
| \`what_signals\` \`named_only\` | boolean | \`true\`/\`false\`, not a string |
| \`what_effects\` \`minRunCount\` | number | Filter effects that ran >= N times |
| \`what_dependency_graph\` \`direction\` | \`"upstream"\` \`"downstream"\` \`"both"\` | Default: both |
| \`what_dom_inspect\` \`depth\` | number | DOM traversal depth (default: 3) |
| \`what_perf\` \`threshold\` | number | Flag effects with >= N subscribers |

### Efficiency

**Parallel-safe (batch these):** \`what_perf\`, \`what_effects\`, \`what_signals\`, \`what_components\`, \`what_dependency_graph\`, \`what_explain\`, \`what_look\`, \`what_page_map\`, \`what_diagnose\`, \`what_lint\`, \`what_scaffold\`. NOT safe to parallelize: \`what_set_signal\` calls on signals that share effects.

**Diff output:** \`effectsTriggered\` = re-ran. \`effectsAdded\` = new mounts. \`effectsRemoved\` = unmounts. \`what_perf\` includes \`largestSubscribers\` — skip \`what_signals\` if you only need hot signals.

### Principles
1. \`what_connection_status\` first — always orient before diving in
2. \`what_explain\` over individual calls — replaces separate signals + effects + DOM lookups
3. \`what_look\` before \`what_screenshot\` — 10x cheaper, usually sufficient
4. \`what_signals\` with \`filter\` and \`named_only: true\` — never dump unfiltered
5. \`what_lint\` before saving generated code
6. Text tools before visual tools — orient with data, then confirm visually
7. Re-fetch component IDs after state changes — IDs are ephemeral after mount/unmount cycles
8. \`what_set_signal\` can cascade — use \`what_diff_snapshot\` to see full impact

### Troubleshooting
- **Not connected:** Open the app in a browser, wait 2-3s, retry. \`what_lint\`/\`what_scaffold\`/\`what_fix\` work offline.
- **"Component N not found":** Re-fetch IDs with \`what_components\` after signal changes that alter the component tree.
- **Screenshot fails:** Use \`what_look\` instead (usually sufficient without an image).
- **\`what_lint\` false positive on \`signal-write-in-render\`:** Both named handlers and inline \`onClick={() => sig(val)}\` trigger this. Safe to ignore if signal write is inside an event handler. Re-run with \`rules\` excluding that rule to confirm.
`);

  // AGENTS.md — model-agnostic instructions for OpenCode, Codex, Gemini, Cursor, etc.
  writeFileSync(resolve(root, 'AGENTS.md'), `# ${packageName} — Agent Instructions

> Model-agnostic guide for AI agents using MCP DevTools with What Framework.

## Framework Basics

Signal-based reactivity. Components run **once**. \`signal()\` for state, \`() =>\` in JSX for reactive text.

\`\`\`js
import { signal, effect, computed, h, mount } from 'what-framework';
const count = signal(0, 'count');
count()           // read
count(5)          // write
count(c => c + 1) // update
\`\`\`

## MCP DevTools

**Always start:** \`what_connection_status\` — returns app info, tool list, next steps.

### Pick the Right Tool

| Goal | Tool | Key params |
|------|------|------------|
| Orient / check connection | \`what_connection_status\` | none |
| Health check | \`what_diagnose\` | none |
| Find a component | \`what_components\` | \`filter\` (regex string) |
| Deep-dive one component | \`what_explain\` | \`componentId\` (number) |
| Check signal values | \`what_signals\` | \`filter\` (string), \`named_only\` (boolean) |
| See effect run counts | \`what_effects\` | \`minRunCount\` (number) |
| Signal dependency graph | \`what_dependency_graph\` | \`signalId\`/\`effectId\` (number), \`direction\` |
| Page layout | \`what_page_map\` | none |
| Component styling | \`what_look\` | \`componentId\` (number) |
| Performance issues | \`what_perf\` | \`threshold\` (number) |
| Before/after state | \`what_diff_snapshot\` | \`action\`: \`"save"\` then \`"diff"\` |
| Change a signal | \`what_set_signal\` | \`signalId\` (number), \`value\` (any) |
| Validate code | \`what_lint\` | \`code\` (string) |
| Generate boilerplate | \`what_scaffold\` | \`type\`, \`name\` (strings) |

### Recipes

**Find component:** \`what_components({filter:"Name"})\` -> \`what_explain({componentId: N})\`
**Debug signal:** \`what_signals({filter:"name"})\` -> \`what_dependency_graph({signalId: N, direction: "downstream"})\`
**Before/after:** \`what_diff_snapshot({action:"save"})\` -> change -> \`what_diff_snapshot({action:"diff"})\`
**Build feature:** \`what_look\` (match styling) -> \`what_scaffold\` -> write code -> \`what_lint\` -> \`what_diff_snapshot\` (save/set/diff)

### Parameter Types (common mistakes)

| Param | Correct | Wrong |
|-------|---------|-------|
| \`named_only\` | \`true\` (boolean) | \`"true"\` (string) |
| \`componentId\` | \`4\` (number) | \`"4"\` (string) |
| \`direction\` | \`"downstream"\` | \`downstream\` |

### Pitfalls

- **Not connected:** Open app in browser, wait 3s, retry
- **Component IDs change** after signal mutations — re-fetch with \`what_components\`
- **\`what_lint\` FP on \`signal-write-in-render\`:** Handlers in event callbacks are safe
- **\`what_set_signal\` cascades:** Use \`what_diff_snapshot\` to see full impact
- **"N signals with no subscribers":** Normal — reactive text bindings bypass tracked effects
`);

  // Also generate a .cursor/mcp.json for Cursor users
  mkdirSync(resolve(root, '.cursor'), { recursive: true });
  writeFileSync(resolve(root, '.cursor', 'mcp.json'), JSON.stringify({
    mcpServers: {
      'what-devtools-mcp': {
        command: 'npx',
        args: ['what-devtools-mcp'],
      },
    },
  }, null, 2) + '\n');

  // .gitignore (.ssr is the islands build's temporary server bundle)
  writeFileSync(resolve(root, '.gitignore'), `node_modules\ndist\n${isIslands ? '.ssr\n' : ''}.DS_Store\n`);

  // package.json
  writeFileSync(resolve(root, 'package.json'), generatePackageJson(packageName, options));

  // index.html (SPA only — the other templates render their own documents)
  if (options.template === 'spa') {
    writeFileSync(resolve(root, 'index.html'), generateIndexHtml(packageName));
  }

  // favicon
  writeFileSync(resolve(root, 'public', 'favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
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

  // vite.config.js (SPA only here — the full-stack template is buildless and
  // the islands template writes its own)
  if (options.template === 'spa') {
    writeFileSync(resolve(root, 'vite.config.js'), generateViteConfig(options));
  }

  // eslint.config.js — eslint-plugin-what flat config.
  //   SPA: the What compiler handles event casing + reactive wrapping, so use
  //        the `compiler` preset (the compiler-covered rules are off).
  //   Fullstack: buildless h() authoring is the template's design, so use
  //        `recommended` with the JSX-only h() rule disabled.
  //   Islands: JSX without the compiler, which is exactly what `recommended`
  //        checks (reactive children, signal calls in JSX, event casing).
  writeFileSync(resolve(root, 'eslint.config.js'), options.template === 'fullstack'
    ? `import what from 'eslint-plugin-what';

export default [
  { ignores: ['node_modules'] },
  what.configs.recommended,
  // This template authors pages with h() on purpose (buildless, no compiler).
  { rules: { 'what/no-h-in-user-code': 'off' } },
];
`
    : isIslands
      ? `import what from 'eslint-plugin-what';

export default [
  { ignores: ['dist', '.ssr', 'node_modules'] },
  // 'recommended' preset: this project's JSX uses the automatic runtime, not
  // the What compiler, so reactive text has to be written as a function.
  what.configs.recommended,
];
`
      : `import what from 'eslint-plugin-what';

export default [
  { ignores: ['dist', 'node_modules'] },
  // 'compiler' preset: this project uses the What compiler (via Vite), which
  // handles event casing and reactive JSX wrapping automatically.
  what.configs.compiler,
];
`);

  // tsconfig.json
  writeFileSync(resolve(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      // The islands template compiles JSX with the automatic runtime, so the
      // typechecker is told the same thing the bundler does.
      jsx: isIslands ? 'react-jsx' : 'preserve',
      jsxImportSource: 'what-framework',
      allowJs: true,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      isolatedModules: true,
      ...(isFullstack ? {} : { types: ['vite/client'] }),
    },
    include: ['src'],
  }, null, 2) + '\n');

  // .vscode
  mkdirSync(resolve(root, '.vscode'), { recursive: true });

  writeFileSync(resolve(root, '.vscode', 'settings.json'), JSON.stringify({
    'typescript.tsdk': 'node_modules/typescript/lib',
    'editor.formatOnSave': true,
  }, null, 2) + '\n');

  writeFileSync(resolve(root, '.vscode', 'extensions.json'), JSON.stringify({
    recommendations: [],
  }, null, 2) + '\n');

  // Full-stack scaffold: file-routed SSR pages + server + client entry + ISR
  // config (writes its own src/styles.css). Islands scaffold: pages, layout,
  // island, both entries, vite.config.js and build.js (also its own styles).
  // SPA scaffold: Vite entry + styles.
  if (options.template === 'fullstack') {
    generateFullstackFiles(root, packageName);
  } else if (isIslands) {
    generateIslandsFiles(root, packageName);
  } else {
    // src/main.jsx
    writeFileSync(resolve(root, 'src', 'main.jsx'), generateMainJsx(options));

    // src/styles.css
    if (reactCompat && cssApproach === 'none') {
      writeFileSync(resolve(root, 'src', 'styles.css'), generateStylesWithReactCompat());
    } else {
      writeFileSync(resolve(root, 'src', 'styles.css'), generateStyles(options));
    }
  }

  // README.md
  writeFileSync(resolve(root, 'README.md'), generateReadme(packageName, options));

  // Summary
  console.log(`\nCreated ${root}.`);

  const features = [];
  if (reactCompat) features.push('React compat (what-react + zustand demo)');
  if (cssApproach === 'tailwind') features.push('Tailwind CSS v4');
  if (cssApproach === 'stylex') features.push('StyleX');
  if (features.length > 0) {
    console.log(`Features: ${features.join(', ')}`);
  }

  console.log('\nNext steps:');
  console.log(`  cd ${formatCdTarget(projectName, root)}`);
  console.log('  npm install');
  if (options.template === 'fullstack') {
    console.log('  npm run dev   # SSR + ISR server → http://localhost:3000\n');
  } else if (isIslands) {
    console.log('  npm run dev     # pages rendered on request');
    console.log('  npm run build   # static HTML in dist/\n');
  } else {
    console.log('  npm run dev\n');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
