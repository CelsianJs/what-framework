import { HYDRATION_FIXES } from './hydration-fixes.js';
/**
 * Offline tools for what-devtools-mcp: lint, scaffold, fix. None of them needs
 * a browser, and their answers describe no page state, so they carry no seq.
 */

import { z } from 'zod';
import { createResponder } from './respond.js';
import { lookup } from './catalogue.js';

// --- Lint ---
// what_lint runs eslint-plugin-what's own rules through ESLint, the same
// implementation `npm run lint` runs in a scaffolded project, so the two
// cannot disagree. The preset is `compiler`, the one create-what configures.

async function lintRules(code, ruleFilter) {
  let Linter;
  let plugin;
  try {
    ({ Linter } = await import('eslint'));
    plugin = (await import('eslint-plugin-what')).default;
  } catch {
    return { lint: 'skipped', issues: [], note: 'eslint or eslint-plugin-what is not installed where the MCP server runs, so only the compile check ran.' };
  }
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
  const messages = new Linter().verify(code, [{
    files: ['**/*.jsx'],
    languageOptions: preset.languageOptions,
    plugins: { what: plugin },
    rules,
  }], { filename: 'snippet.jsx' });
  const fatal = messages.find((m) => m.fatal);
  if (fatal) {
    return { lint: 'not parsed', issues: [], note: `The lint rules need plain JavaScript/JSX (${fatal.message}); TypeScript syntax is only compiled.` };
  }
  return {
    lint: true,
    issues: messages.filter((m) => m.ruleId).map((m) => {
      const rule = m.ruleId.replace(/^what\//, '');
      const catalogued = plugin.rules[rule]?.meta?.docs?.code;
      return { severity: m.severity === 2 ? 'error' : 'warning', ...(catalogued ? { code: catalogued } : {}), rule, line: m.line, message: m.message };
    }),
  };
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
  component: ({ name, props, signals }) => {
    const declarations = signals.map((s) => `  const ${s} = signal(${initialFor(s)}, '${s}');`);
    const lines = [
      ...props.map((p) => `      <p>${p}: {props.${p}()}</p>`),
      ...signals.map((s) => `      <p>${s}: {${s}()}</p>`),
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
    const declarations = signals.filter((s) => s !== 'loading').map((s) => `  const ${s} = signal(${initialFor(s)}, '${s}');`);
    return `import { signal, onMount, Head } from 'what-framework';

export default function ${name}() {
  const loading = signal(true, 'loading');
${declarations.join('\n')}${declarations.length ? '\n' : ''}
  onMount(() => {
    // Load the page's data here, then:
    loading(false);
  });

  return (
    <main>
      <Head title="${name}" />
      <h1>${name}</h1>
      <p>{loading() ? 'Loading…' : 'Ready'}</p>
    </main>
  );
}
`;
  },

  form: ({ name, signals }) => {
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
    <form onSubmit={submit}>
${fields.map((f) => `      <label>
        ${titled(f)}
        <input type="${inputType(f)}" {...form.register('${f}')} />
      </label>
      <p class="error" role="alert">{() => form.formState.error('${f}')?.message}</p>`).join('\n')}
      <button type="submit" disabled={form.formState.isSubmitting()}>
        {form.formState.isSubmitting() ? 'Submitting…' : 'Submit'}
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

  island: ({ name, props, signals }) => {
    const declarations = (signals.length ? signals : ['active']).map((s) => `  const ${s} = signal(${s === 'active' ? 'false' : initialFor(s)}, '${s}');`);
    const toggle = signals.length ? signals[0] : 'active';
    return `import { signal, onMount } from 'what-framework';

// An island: the server renders its HTML and the client hydrates it on its own,
// with the props the server serialized (plain values). Register it on the
// server: island('${camel(name)}', () => import('./${name}.jsx')).
export default function ${name}(props) {
${declarations.join('\n')}

  onMount(() => {
    // Client-only setup.
  });

  return (
    <div data-island="${camel(name)}">
${props.map((p) => `      <p>${p}: {props.${p}}</p>`).join('\n')}${props.length ? '\n' : ''}      <button onClick={() => ${toggle}((v) => !v)}>{${toggle}() ? 'On' : 'Off'}</button>
    </div>
  );
}
`;
  },
};

/**
 * Scaffold source for one type, as what_scaffold returns it. Also renders the
 * what://docs/patterns resource, so the documented patterns are the tested ones.
 * @param {'component'|'page'|'form'|'store'|'island'} type
 * @param {{ name: string, props?: string[], signals?: string[] }} options
 */
export function scaffold(type, { name, props = [], signals = [] }) {
  return SCAFFOLD_TEMPLATES[type]({ name, props, signals });
}

// --- Compile check ---
// Runs the snippet through the real What compiler, offline, when the project
// has it installed (every scaffolded app does). Parse errors and the
// compiler's own build-time diagnostics (ERR_MISSING_KEY) come back as issues.

async function compileCheck(code) {
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
    const line = Number(text.match(/snippet\.jsx:(\d+)/)?.[1]) || undefined;
    issues.push({ severity: 'warning', code: reported || 'COMPILER_WARNING', message: text.replace(/^\[what-compiler\]\s*/, '').replace(/ at \/snippet\.jsx:\d+:\d+/, ''), line, rule: 'compiler' });
  };
  try {
    babel.transformSync(code, {
      filename: '/snippet.jsx',
      configFile: false,
      babelrc: false,
      plugins: [plugin],
      parserOpts: { plugins: ['jsx', 'typescript'] },
    });
    return { compiled: true, issues };
  } catch (e) {
    const message = String(e.message || e).replace(/^\/snippet\.jsx: /, '').split('\n')[0];
    issues.push({ severity: 'error', code: 'PARSE_ERROR', message, line: e.loc?.line, rule: 'compiler' });
    return { compiled: false, issues };
  } finally {
    console.warn = originalWarn;
  }
}

// --- Register Agent Tools ---

export function registerAgentTools(server, bridge) {
  const { ok, fail } = createResponder(bridge);

  server.tool(
    'what_lint',
    'Check a code snippet offline: eslint-plugin-what\'s rules (the compiler preset a scaffolded project uses, run through ESLint) plus, when what-compiler is installed, a real compile that reports parse errors and build-time diagnostics. No browser needed.',
    {
      code: z.string().describe('The What Framework code to check'),
      rules: z.array(z.string()).optional().describe('eslint-plugin-what rule names to run instead of the preset, e.g. ["no-moved-imports"]'),
      compile: z.boolean().optional().default(true).describe('Also compile the snippet with what-compiler (default true)'),
    },
    async ({ code, rules: ruleFilter, compile }) => {
      const linted = await lintRules(code, ruleFilter);
      if (linted.error) return fail(linted.error, `Available: ${linted.available.join(', ')}`);
      const issues = [...linted.issues];
      const out = { lint: linted.lint };
      const notes = linted.note ? [linted.note] : [];
      if (compile) {
        const result = await compileCheck(code);
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
      const code = scaffold(type, { name, props, signals });
      const path = type === 'store' ? `src/stores/${name.charAt(0).toLowerCase()}${name.slice(1)}.js`
        : `src/${type === 'page' ? 'pages' : 'components'}/${name}.jsx`;
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
