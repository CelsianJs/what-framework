import { HYDRATION_FIXES } from './hydration-fixes.js';
/**
 * Offline tools for what-devtools-mcp: lint, scaffold, fix. None of them needs
 * a browser, and their answers describe no page state, so they carry no seq.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { createResponder } from './respond.js';
import { lookup } from './catalogue.js';

// --- Lint ---
function projectTemplate(root) {
  if (existsSync(resolve(root, 'client-files.js')) && existsSync(resolve(root, 'src/routes.js'))) return 'fullstack';
  if (existsSync(resolve(root, 'src/entry-server.js')) && existsSync(resolve(root, 'src/islands'))) return 'islands';
  return 'spa';
}

function lintResult(messages, plugin) {
  const fatal = messages.find((m) => m.fatal);
  if (fatal) return { lint: 'not parsed', issues: [], note: fatal.message };
  return {
    lint: true,
    issues: messages.filter((m) => m.ruleId || m.severity).map((m) => {
      const rule = m.ruleId?.replace(/^what\//, '');
      const catalogued = m.ruleId?.startsWith('what/') ? plugin?.rules[rule]?.meta?.docs?.code : null;
      return { severity: m.severity === 2 ? 'error' : 'warning', ...(catalogued ? { code: catalogued } : {}), rule, line: m.line, message: m.message };
    }),
  };
}

async function lintRules(code, ruleFilter, root, filename) {
  const load = createRequire(resolve(root, 'package.json'));
  let eslintModule;
  let plugin;
  try {
    try { eslintModule = load('eslint'); } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') throw e;
      eslintModule = await import('eslint');
    }
  } catch {
    return { lint: 'skipped', issues: [], note: 'ESLint is not installed where the MCP server runs.' };
  }
  try {
    const ownPlugin = load('eslint-plugin-what');
    plugin = ownPlugin.default || ownPlugin;
  } catch {
    try { plugin = (await import('eslint-plugin-what')).default; } catch { /* other project rules can still run */ }
  }

  if (!ruleFilter?.length) {
    const eslint = new eslintModule.ESLint({ cwd: root });
    if (await eslint.findConfigFile(filename)) {
      const [result] = await eslint.lintText(code, { filePath: filename });
      return lintResult(result.messages, plugin);
    }
  }
  if (!plugin) return { lint: 'skipped', issues: [], note: 'eslint-plugin-what is not installed where the MCP server runs.' };

  const preset = plugin.configs.compiler;
  let rules = preset.rules;
  if (ruleFilter?.length) {
    const names = ruleFilter.map((r) => r.replace(/^what\//, ''));
    const unknown = names.filter((n) => !plugin.rules[n]);
    if (unknown.length) return { error: `Unknown rule: ${unknown.join(', ')}`, available: Object.keys(plugin.rules) };
    rules = Object.fromEntries(names.map((n) => {
      const setting = preset.rules[`what/${n}`];
      const level = Array.isArray(setting) ? setting[0] : setting;
      return [`what/${n}`, level && level !== 'off' ? setting : 'warn'];
    }));
  }
  return lintResult(new eslintModule.Linter().verify(code, [{
    files: ['**/*.jsx'],
    languageOptions: preset.languageOptions,
    plugins: { what: plugin },
    rules,
  }], { filename: 'snippet.jsx' }), plugin);
}

// --- Scaffold Templates ---
// Every template is compiled and run by test/scaffold-smoke.test.js and linted
// clean by the rules above. A component runs once and its props are the plain
// values the parent passed, so a prop that changes arrives as an accessor
// (<Row text={text} />, not text={text()}) and the component calls it where it
// renders.

const initialFor = (name) => (/^(is|has|show|can|should)[A-Z]/.test(name) ? 'false' : "''");
const camel = (name) => name.charAt(0).toLowerCase() + name.slice(1);
const titled = (name) => name.charAt(0).toUpperCase() + name.slice(1);

const SCAFFOLD_TEMPLATES = {
  component: ({ name, props, signals, reactive }) => {
    const declarations = signals.map((s) => `  const ${s} = signal(${initialFor(s)}, '${s}');`);
    const lines = [
      ...props.map((p) => `      <p>${p}: {${reactive}props.${p}()}</p>`),
      ...signals.map((s) => `      <p>${s}: {${reactive}${s}()}</p>`),
    ];
    return `${signals.length ? "import { signal } from 'what-framework';\n\n" : ''}// Runs once. Props are the values the parent passed, so a value that changes
// comes in as an accessor (<${name} label={label} />, not label={label()}) and
// is called where it renders: props.label() inside JSX.
export default function ${name}(props) {
${declarations.length ? `${declarations.join('\n')}\n\n` : ''}  return (
    <section class="${camel(name)}">
      <h2>${name}</h2>
${lines.join('\n') || '      <p>Add content here.</p>'}
    </section>
  );
}
`;
  },

  page: ({ name, signals }) => {
    const fields = signals.filter((s) => s !== 'status');
    const declarations = fields.map((s) => `  const ${s} = signal(${initialFor(s)}, '${s}');`);
    return `import { computed, Head, Suspense${declarations.length ? ', signal' : ''} } from 'what-framework';

export default function ${name}() {
  // Replace this async callback with your data source.
  const status = computed(async () => 'Ready', 'status');
${declarations.join('\n')}${declarations.length ? '\n' : ''}
  return (
    <main>
      <Head title="${name}" />
      <h1>${name}</h1>
      <Suspense fallback={<p>Loading…</p>}>
        <p>{() => status()}</p>
      </Suspense>
${fields.map((s) => `      <p>${s}: {() => ${s}()}</p>\n`).join('')}    </main>
  );
}
`;
  },

  form: ({ name, signals, reactive }) => {
    const fields = signals.length ? signals : ['email', 'password'];
    const inputType = (f) => (/^pass(word)?$/i.test(f) ? 'password' : /^e-?mail$/i.test(f) ? 'email' : 'text');
    const rulesFor = (f) => `[rules.required('${titled(f)} is required')${inputType(f) === 'email' ? ', rules.email()' : ''}]`;
    return `import { useForm, rules, simpleResolver } from 'what-framework/form';

export default function ${name}(props) {
  const form = useForm({
    defaultValues: { ${fields.map((f) => `${f}: ''`).join(', ')} },
    resolver: simpleResolver({
${fields.map((f) => `      ${f}: ${rulesFor(f)},`).join('\n')}
    }),
  });

  // handleSubmit validates first and calls this only with valid values.
  const submit = form.handleSubmit(async (values) => {
    await props.onSubmit?.(values);
  });

  return (
    <form ${reactive ? 'onsubmit' : 'onSubmit'}={submit}>
${fields.map((f) => `      <label>
        ${titled(f)}
        <input type="${inputType(f)}" {...form.register('${f}')} />
      </label>
      <p class="error" role="alert">{() => form.formState.error('${f}')?.message}</p>`).join('\n')}
      <button type="submit" disabled={${reactive}form.formState.isSubmitting()}>
        {${reactive}form.formState.isSubmitting() ? 'Submitting…' : 'Submit'}
      </button>
    </form>
  );
}
`;
  },

  store: ({ name, signals }) => {
    const hook = `use${titled(name)}`;
    const fields = signals.length ? signals : ['items'];
    const state = fields.map((s) => `  ${s}: ${s === 'items' ? '[]' : initialFor(s) === 'false' ? 'false' : 'null'},`);
    const actions = fields.map((s) => s === 'items'
      ? `  addItem(item) {\n    this.items = [...this.items, item];\n  },`
      : `  set${titled(s)}(value) {\n    this.${s} = value;\n  },`);
    return `import { createStore${fields.includes('items') ? ', derived' : ''} } from 'what-framework';

// createStore returns a hook. Call it anywhere for the state (reactive getters)
// and the actions; an action reads and assigns state through \`this\`, and its
// writes are batched:
//   const store = ${hook}();
//   store.${fields.includes('items') ? "addItem('milk'); store.items" : `set${titled(fields[0])}(1); store.${fields[0]}`}
const ${hook} = createStore({
${state.join('\n')}
${fields.includes('items') ? '  itemCount: derived((state) => state.items.length),\n' : ''}${actions.join('\n')}
});

export default ${hook};
`;
  },

  island: ({ name, props, signals, reactive }) => {
    const declarations = (signals.length ? signals : ['active']).map((s) => `  const ${s} = signal(${s === 'active' ? 'false' : initialFor(s)}, '${s}');`);
    const toggle = signals.length ? signals[0] : 'active';
    return `import { signal } from 'what-framework';

// An island: the server renders its HTML and the client hydrates it on its own,
// with the props the server serialized (plain values). Register its loader
// in the client entry: island('${camel(name)}', () => import('./${reactive ? 'islands/' : 'components/'}${name}.jsx')).
export default function ${name}(props) {
${declarations.join('\n')}

  return (
    <div data-island="${camel(name)}">
${props.map((p) => `      <p>${p}: {props.${p}}</p>`).join('\n')}${props.length ? '\n' : ''}      <button ${reactive ? 'onclick' : 'onClick'}={() => ${toggle}((v) => !v)}>{${reactive}${toggle}() ? 'On' : 'Off'}</button>
    </div>
  );
}
`;
  },
};

function buildlessScaffold(type, { name, props, signals }) {
  const imports = (names) => `import { ${names} } from 'what-framework';

`;
  const declarations = (list) => list.map((s) => `  const ${s} = signal(${s === 'active' ? 'false' : initialFor(s)}, '${s}');
`).join('');
  if (type === 'page') {
    const fields = signals.filter((s) => s !== 'data');
    return `${imports(`h, Head, useLoaderData${fields.length ? ', signal' : ''}`)}export const page = { mode: 'server' };

export async function loader() {
  return { status: 'Ready' };
}

export default function ${name}() {
  const data = useLoaderData();
${declarations(fields)}  return h('main', {},
    h(Head, { title: '${name}' }),
    h('h1', {}, '${name}'),
    h('p', {}, data.status)${fields.map((s) => `,
    h('p', {}, '${s}: ', () => ${s}())`).join('')},
  );
}
`;
  }
  if (type === 'form') {
    const fields = signals.length ? signals : ['email', 'password'];
    return `${imports('h').trimEnd()}
import { useForm, rules, simpleResolver } from 'what-framework/form';

export default function ${name}(props) {
  const form = useForm({
    defaultValues: { ${fields.map((f) => `${f}: ''`).join(', ')} },
    resolver: simpleResolver({
${fields.map((f) => `      ${f}: [rules.required('${titled(f)} is required')],`).join('\n')}
    }),
  });
  return h('form', { onSubmit: form.handleSubmit(async (values) => props.onSubmit?.(values)) },
${fields.map((f) => `    h('label', {}, '${titled(f)}', h('input', form.register('${f}'))),
    h('p', { class: 'error', role: 'alert' }, () => form.formState.error('${f}')?.message),`).join('\n')}
    h('button', { type: 'submit', disabled: form.formState.isSubmitting }, () => form.formState.isSubmitting() ? 'Submitting…' : 'Submit'),
  );
}
`;
  }
  const island = type === 'island';
  const fields = island && !signals.length ? ['active'] : signals;
  return `${imports(fields.length ? 'h, signal' : 'h')}export default function ${name}(${props.length ? 'props' : ''}) {
${declarations(fields)}  return h('section', {},
    h('h2', {}, '${name}')${props.map((p) => `,
    h('p', {}, '${p}: ', ${island ? `props.${p}` : `() => props.${p}()`})`).join('')}${fields.map((s) => `,
    h('p', {}, '${s}: ', () => ${s}())`).join('')}${island ? `,
    h('button', { onClick: () => ${fields[0]}((value) => !value) }, () => ${fields[0]}() ? 'On' : 'Off')` : ''},
  );
}
`;
}

/**
 * Scaffold source for one type, as what_scaffold returns it. Also renders the
 * what://docs/patterns resource, so the documented patterns are the tested ones.
 * @param {'component'|'page'|'form'|'store'|'island'} type
 * @param {{ name: string, props?: string[], signals?: string[], template?: string }} options
 */
export function scaffold(type, { name, props = [], signals = [], template = 'spa' }) {
  if (template === 'fullstack' && type !== 'store') return buildlessScaffold(type, { name, props, signals });
  return SCAFFOLD_TEMPLATES[type]({ name, props, signals, reactive: template === 'islands' ? '() => ' : '' });
}

// --- Compile check ---
// Runs the snippet through the real What compiler, offline, when the project
// has it installed (every scaffolded app does). Parse errors and the
// compiler's own build-time diagnostics (ERR_MISSING_KEY) come back as issues.

async function compileCheck(code, filename, root) {
  let babel;
  let plugin;
  try {
    babel = await import('@babel/core');
    plugin = (await import('what-compiler/babel')).default;
  } catch {
    return { compiled: 'skipped', issues: [], note: 'what-compiler or @babel/core is not installed where the MCP server runs, so only the lint rules ran.' };
  }
  const issues = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const text = args.join(' ');
    const reported = text.match(/\b(ERR_[A-Z0-9_]+)\b/)?.[1];
    const line = Number(text.match(/:(\d+):\d+\b/)?.[1]) || undefined;
    issues.push({ severity: 'warning', code: reported || 'COMPILER_WARNING', message: text.replace(/^\[what-compiler\]\s*/, '').replace(/ at [^\n]+?:\d+:\d+/, ''), line, rule: 'compiler' });
  };
  try {
    babel.transformSync(code, {
      filename,
      configFile: false,
      babelrc: false,
      plugins: [[plugin, { projectRoot: root }]],
      parserOpts: { plugins: ['jsx', 'typescript'] },
    });
    return { compiled: true, issues };
  } catch (e) {
    const message = String(e.message || e).replace(`${filename}: `, '').split('\n')[0];
    const code = e.code?.startsWith('ERR_') ? e.code : message.match(/\bERR_[A-Z0-9_]+\b/)?.[0]
      || (e.code === 'BABEL_PARSE_ERROR' ? 'PARSE_ERROR' : 'COMPILER_ERROR');
    issues.push({ severity: 'error', code, message, line: e.loc?.line, rule: 'compiler' });
    return { compiled: false, issues };
  } finally {
    console.warn = originalWarn;
  }
}

// --- Register Agent Tools ---

export function registerAgentTools(server, bridge, { root = process.cwd() } = {}) {
  const { ok, fail } = createResponder(bridge);

  server.tool(
    'what_lint',
    'Check code offline with the project ESLint config (compiler preset if absent) and the What compiler. Pass the intended file path for path-specific rules.',
    {
      code: z.string().describe('The What Framework code to check'),
      filePath: z.string().optional().describe('Intended path relative to the MCP project root'),
      rules: z.array(z.string()).optional().describe('eslint-plugin-what rule names to run instead of the preset, e.g. ["no-moved-imports"]'),
      compile: z.boolean().optional().default(true).describe('Also compile the snippet with what-compiler (default true)'),
    },
    async ({ code, filePath, rules: ruleFilter, compile }) => {
      const name = filePath || (projectTemplate(root) === 'fullstack' ? 'src/snippet.js' : 'src/snippet.jsx');
      const filename = resolve(root, name);
      const fromRoot = relative(root, filename);
      if (isAbsolute(name) || !fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) return fail('filePath must be a file inside the project.');
      const linted = await lintRules(code, ruleFilter, root, filename);
      if (linted.error) return fail(linted.error, `Available: ${linted.available.join(', ')}`);
      const issues = [...linted.issues];
      const out = { lint: linted.lint };
      const notes = linted.note ? [linted.note] : [];
      if (compile) {
        const result = await compileCheck(code, filename, root);
        issues.push(...result.issues);
        out.compiled = result.compiled;
        if (result.note) notes.push(result.note);
      }
      issues.sort((a, b) => (a.line || 0) - (b.line || 0));

      out.errors = issues.filter((i) => i.severity === 'error').length;
      out.warnings = issues.filter((i) => i.severity === 'warning').length;
      out.issues = issues;
      if (notes.length) out.note = notes.join(' ');
      return ok(out);
    }
  );

  server.tool(
    'what_scaffold',
    'Idiomatic What Framework code for a component, page, form, store or island, written against the current APIs (each template is compiled, run and linted in the test suite). No browser needed.',
    {
      type: z.enum(['component', 'page', 'form', 'store', 'island']).describe('What to generate'),
      name: z.string().describe('Name (PascalCase for components)'),
      props: z.array(z.string()).optional().describe('Prop names the component reads (component, island)'),
      signals: z.array(z.string()).optional().describe('Signal names (component, page, island), field names (form) or state keys (store)'),
    },
    async ({ type, name, props, signals }) => {
      if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
        return fail(`Name "${name}" should be PascalCase`, `Use "${name.charAt(0).toUpperCase() + name.slice(1).replace(/[^A-Za-z0-9]/g, '')}": a lowercase JSX tag is treated as an HTML element.`);
      }
      const identifiers = [...(props || []), ...(signals || [])];
      const bad = identifiers.find((n) => !/^[A-Za-z_$][\w$]*$/.test(n));
      if (bad) return fail(`"${bad}" is not a JavaScript identifier`);
      const template = projectTemplate(root);
      const code = scaffold(type, { name, props, signals, template });
      const path = type === 'store' ? `src/stores/${name.charAt(0).toLowerCase()}${name.slice(1)}.js`
        : `src/${type === 'page' ? 'pages' : type === 'island' && template === 'islands' ? 'islands' : 'components'}/${template === 'fullstack' && type === 'page' ? camel(name) : name}.${template === 'fullstack' ? 'js' : 'jsx'}`;
      return ok({ type, name, path, code });
    }
  );

  server.tool(
    'what_fix',
    'The fix for a What Framework diagnostic: severity, what it means, how to fix it and a worked bad/good example. Accepts a code (ERR_INFINITE_EFFECT) or an error message containing one. No browser needed.',
    {
      error: z.string().describe('Error code, e.g. "ERR_INFINITE_EFFECT", or the error message'),
      kind: z.enum(['tag', 'text', 'missing', 'extra-nodes', 'marker', 'key', 'not-hydratable', 'shadow-root']).optional()
        .describe('Hydration mismatch kind for a targeted fix'),
    },
    async ({ error, kind }) => {
      const found = lookup(error);
      if (!found.def) {
        return ok({
          found: false,
          closest: found.closest,
          hint: found.closest.length
            ? `No catalogue code matches "${error}". Closest codes: ${found.closest.join(', ')}. Pass one of them, or the exact message.`
            : `No catalogue code matches "${error}". Pass a code from docs/ERRORS.md or the exact message.`,
        });
      }
      const def = found.def;
      if (kind && def.code === 'ERR_HYDRATION_MISMATCH') {
        return ok({ found: true, code: def.code, severity: def.severity, kind, fix: HYDRATION_FIXES[kind] });
      }
      return ok({
        found: true,
        code: def.code,
        severity: def.severity,
        ...(found.via === 'message' ? { matchedBy: 'message' } : {}),
        message: def.template,
        fix: def.suggestion,
        example: def.codeExample,
      });
    }
  );
}
