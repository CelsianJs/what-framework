/**
 * Agent-first MCP tools for what-devtools-mcp.
 * 5 new tools: lint, scaffold, validate, perf, fix.
 * Plus enhancements to existing tools (errors, snapshot).
 *
 * These tools make WhatFW THE framework designed for AI coding agents.
 */

import { z } from 'zod';

// --- Error code database (mirrors packages/core/src/errors.js) ---
const ERROR_DATABASE = {
  ERR_INFINITE_EFFECT: {
    code: 'ERR_INFINITE_EFFECT',
    severity: 'error',
    diagnosis: 'An effect reads and writes the same signal, creating an infinite update cycle. The effect triggers itself on every run.',
    suggestedFix: 'Use untrack() to read the signal without subscribing, or restructure so the read and write are in separate effects.',
    codeExample: `// Bad — reads and writes count, creating a cycle:
effect(() => { count(count() + 1); });

// Fix — use untrack() so the read doesn't subscribe:
effect(() => { count(untrack(count) + 1); });

// Better — split into separate logic:
const doubled = computed(() => count() * 2);`,
  },
  ERR_MISSING_SIGNAL_READ: {
    code: 'ERR_MISSING_SIGNAL_READ',
    severity: 'warning',
    diagnosis: 'A signal function reference is used where its value was intended. Signals are functions — they must be called with () to read their value.',
    suggestedFix: 'Add () after the signal name. In JSX: {count()} not {count}. In template literals: `${count()}` not `${count}`.',
    codeExample: `// Bad:
<span>{count}</span>        // renders "[Function]"

// Good:
<span>{count()}</span>      // renders the actual value`,
  },
  ERR_HYDRATION_MISMATCH: {
    code: 'ERR_HYDRATION_MISMATCH',
    severity: 'error',
    diagnosis: 'Server-rendered HTML does not match what the client expects. This causes the DOM to be rebuilt, losing any server-rendered content benefits.',
    suggestedFix: 'Avoid reading browser-only APIs (window, localStorage, navigator) during the initial render. Use onMount() for client-only logic.',
    codeExample: `// Bad — different on server vs client:
function App() {
  return <p>{window.innerWidth}</p>;
}

// Good — use onMount for client-only values:
function App() {
  const width = signal(0);
  onMount(() => width(window.innerWidth));
  return <p>{width()}</p>;
}`,
  },
  ERR_ORPHAN_EFFECT: {
    code: 'ERR_ORPHAN_EFFECT',
    severity: 'warning',
    diagnosis: 'An effect was created outside any reactive root or component. It will never be automatically cleaned up, causing a memory leak.',
    suggestedFix: 'Create effects inside component functions (where they are auto-tracked) or wrap in createRoot().',
    codeExample: `// Bad — orphaned, leaks memory:
effect(() => console.log(count()));

// Good — inside a root with cleanup:
createRoot(dispose => {
  effect(() => console.log(count()));
  // later: dispose() cleans up
});`,
  },
  ERR_SIGNAL_WRITE_IN_RENDER: {
    code: 'ERR_SIGNAL_WRITE_IN_RENDER',
    severity: 'error',
    diagnosis: 'A signal is being written during the component render phase (the component function body). This triggers immediate re-execution and can cause infinite loops.',
    suggestedFix: 'Move signal writes into event handlers, effects, or onMount(). The component body should only read signals.',
    codeExample: `// Bad — write during render:
function Counter() {
  count(count() + 1);  // infinite loop!
  return <span>{count()}</span>;
}

// Good — write in event handler:
function Counter() {
  return <button onclick={() => count(c => c + 1)}>{count()}</button>;
}`,
  },
  ERR_MISSING_CLEANUP: {
    code: 'ERR_MISSING_CLEANUP',
    severity: 'warning',
    diagnosis: 'An effect sets up a resource (event listener, timer, connection) but does not return a cleanup function. This causes memory leaks when the component unmounts.',
    suggestedFix: 'Return a cleanup function from the effect that removes the resource.',
    codeExample: `// Bad — no cleanup:
effect(() => {
  window.addEventListener('resize', handler);
});

// Good — return cleanup:
effect(() => {
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
});`,
  },
  ERR_UNSAFE_INNERHTML: {
    code: 'ERR_UNSAFE_INNERHTML',
    severity: 'warning',
    diagnosis: 'innerHTML is set directly on an element without the __html safety marker. This is an XSS risk if the content comes from user input.',
    suggestedFix: 'Use { __html: content } to explicitly mark innerHTML as intentional, or use the html tagged template literal.',
    codeExample: `// Bad — raw innerHTML (XSS risk):
<div innerHTML={userInput} />

// Good — explicit opt-in:
<div innerHTML={{ __html: sanitizedContent }} />`,
  },
  ERR_MISSING_KEY: {
    code: 'ERR_MISSING_KEY',
    severity: 'warning',
    diagnosis: 'A list is rendered without key props. Without keys, the framework cannot efficiently track item identity during reordering, leading to incorrect UI updates.',
    suggestedFix: 'Add a unique key prop to each list item using a stable identifier (like a database ID), not the array index.',
    codeExample: `// Bad — no key:
<For each={items()}>{item => <li>{item.name}</li>}</For>

// Good — stable key:
<For each={items()}>{item => <li key={item.id}>{item.name}</li>}</For>`,
  },
  HINT_PREFER_COMPUTED: {
    code: 'HINT_PREFER_COMPUTED',
    severity: 'info',
    diagnosis: 'An effect is only used to derive a value from other signals. This is better expressed as a computed() signal, which is lazy and more efficient.',
    suggestedFix: 'Replace the effect + signal pair with a single computed() signal.',
    codeExample: `// Before — effect + signal (runs eagerly, more memory):
const doubled = signal(0);
effect(() => { doubled(count() * 2); });

// After — computed (lazy, efficient):
const doubled = computed(() => count() * 2);`,
  },
};

// --- Lint Patterns ---
// Static analysis rules applied to code snippets.

const LINT_RULES = [
  {
    id: 'missing-signal-read',
    code: 'ERR_MISSING_SIGNAL_READ',
    severity: 'error',
    test(code) {
      const issues = [];
      // Find signal declarations
      const signalDecls = [...code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:signal|useSignal)\s*\(/g)];
      const signalNames = signalDecls.map(m => m[1]);

      for (const name of signalNames) {
        // Look for JSX usage without () — e.g., {count} but not {count()}
        const jsxPattern = new RegExp(`\\{\\s*${name}\\s*\\}`, 'g');
        let match;
        while ((match = jsxPattern.exec(code)) !== null) {
          // Make sure it's not {count()} — check the char before }
          const snippet = code.slice(match.index, match.index + match[0].length);
          if (!snippet.includes(`${name}(`)) {
            const line = code.slice(0, match.index).split('\n').length;
            issues.push({
              severity: 'error',
              code: 'ERR_MISSING_SIGNAL_READ',
              message: `Signal "${name}" used in JSX without calling () — will render as "[Function]". Use {${name}()} instead.`,
              line,
              suggestedFix: `Change {${name}} to {${name}()}`,
            });
          }
        }

        // Template literal without ()
        const templatePattern = new RegExp(`\\\$\\{\\s*${name}\\s*\\}`, 'g');
        while ((match = templatePattern.exec(code)) !== null) {
          if (!match[0].includes(`${name}(`)) {
            const line = code.slice(0, match.index).split('\n').length;
            issues.push({
              severity: 'error',
              code: 'ERR_MISSING_SIGNAL_READ',
              message: `Signal "${name}" in template literal without () — will stringify as "[Function]". Use \${${name}()} instead.`,
              line,
              suggestedFix: `Change \${${name}} to \${${name}()}`,
            });
          }
        }
      }
      return issues;
    },
  },
  {
    id: 'innerhtml-without-html',
    code: 'ERR_UNSAFE_INNERHTML',
    severity: 'warning',
    test(code) {
      const issues = [];
      const pattern = /innerHTML\s*=\s*\{(?!.*__html)/g;
      let match;
      while ((match = pattern.exec(code)) !== null) {
        const line = code.slice(0, match.index).split('\n').length;
        issues.push({
          severity: 'warning',
          code: 'ERR_UNSAFE_INNERHTML',
          message: 'innerHTML set without __html safety marker — potential XSS risk.',
          line,
          suggestedFix: 'Use innerHTML={{ __html: content }} to explicitly mark as intentional.',
        });
      }
      return issues;
    },
  },
  {
    id: 'effect-writes-read-signal',
    code: 'ERR_INFINITE_EFFECT',
    severity: 'error',
    test(code) {
      const issues = [];
      // Find effect blocks and check for read+write of same signal
      const effectPattern = /effect\s*\(\s*\(\s*\)\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
      let match;
      while ((match = effectPattern.exec(code)) !== null) {
        const body = match[1];
        // Find signal reads: name()
        const reads = [...body.matchAll(/(\w+)\(\)/g)].map(m => m[1]);
        // Find signal writes: name(value) where value is not empty
        const writes = [...body.matchAll(/(\w+)\([^)]+\)/g)].map(m => m[1]);

        for (const name of reads) {
          if (writes.includes(name) && name !== 'console' && name !== 'Math' && name !== 'JSON' && name !== 'Date') {
            const line = code.slice(0, match.index).split('\n').length;
            issues.push({
              severity: 'error',
              code: 'ERR_INFINITE_EFFECT',
              message: `Effect reads and writes signal "${name}" — will cause infinite loop. Use untrack(${name}) for the read.`,
              line,
              suggestedFix: `Replace ${name}() reads with untrack(${name}) inside this effect.`,
            });
          }
        }
      }
      return issues;
    },
  },
  {
    id: 'missing-cleanup',
    code: 'ERR_MISSING_CLEANUP',
    severity: 'warning',
    test(code) {
      const issues = [];
      // Check effects that add listeners but don't return cleanup
      const effectPattern = /effect\s*\(\s*\(\s*\)\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
      let match;
      while ((match = effectPattern.exec(code)) !== null) {
        const body = match[1];
        const hasListener = body.includes('addEventListener') || body.includes('setInterval') || body.includes('setTimeout');
        const hasReturn = body.includes('return');

        if (hasListener && !hasReturn) {
          const line = code.slice(0, match.index).split('\n').length;
          const resource = body.includes('addEventListener') ? 'event listener'
            : body.includes('setInterval') ? 'interval'
            : 'timeout';
          issues.push({
            severity: 'warning',
            code: 'ERR_MISSING_CLEANUP',
            message: `Effect sets up ${resource} but does not return a cleanup function — memory leak risk.`,
            line,
            suggestedFix: `Return a cleanup function: return () => remove${resource === 'event listener' ? 'EventListener(...)' : resource === 'interval' ? 'clearInterval(id)' : 'clearTimeout(id)'}`,
          });
        }
      }
      return issues;
    },
  },
  {
    id: 'signal-write-in-render',
    code: 'ERR_SIGNAL_WRITE_IN_RENDER',
    severity: 'error',
    test(code) {
      const issues = [];
      // Find signal declarations
      const signalDecls = [...code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:signal|useSignal)\s*\(/g)];
      const signalNames = signalDecls.map(m => m[1]);

      // Find component functions (PascalCase function declarations)
      const componentPattern = /function\s+([A-Z]\w*)\s*\([^)]*\)\s*\{/g;
      let compMatch;
      while ((compMatch = componentPattern.exec(code)) !== null) {
        // Get the component body (rough extraction)
        const startIdx = compMatch.index + compMatch[0].length;
        let braceDepth = 1;
        let bodyEnd = startIdx;
        for (let i = startIdx; i < code.length && braceDepth > 0; i++) {
          if (code[i] === '{') braceDepth++;
          if (code[i] === '}') braceDepth--;
          bodyEnd = i;
        }
        const body = code.slice(startIdx, bodyEnd);

        // For each signal, check if it's written at the TOP LEVEL of the component body
        // (not inside effect(), onMount(), setTimeout, event handlers, arrow functions)
        for (const name of signalNames) {
          // Look for signal writes: name(someValue) where someValue is not empty
          const writePattern = new RegExp(`(?<!\\w)${name}\\s*\\((?!\\s*\\))(?!.*=>)`, 'g');
          let writeMatch;
          while ((writeMatch = writePattern.exec(body)) !== null) {
            // Check if this write is inside a nested function/callback
            const beforeWrite = body.slice(0, writeMatch.index);
            const nestedDepth = (beforeWrite.match(/(?:effect|onMount|setTimeout|setInterval|addEventListener|=>)\s*(?:\([^)]*\)\s*)?\{/g) || []).length;
            const closingBraces = (beforeWrite.match(/\}/g) || []).length;

            // If we're at top level of the component (not inside a nested callback)
            if (nestedDepth <= closingBraces) {
              // Check it's not a signal READ (no args or the call is just `name()`)
              const fullCall = body.slice(writeMatch.index, writeMatch.index + writeMatch[0].length + 50);
              if (!fullCall.match(new RegExp(`^${name}\\s*\\(\\s*\\)`))) {
                const line = code.slice(0, compMatch.index + compMatch[0].length + writeMatch.index).split('\n').length;
                issues.push({
                  severity: 'error',
                  code: 'ERR_SIGNAL_WRITE_IN_RENDER',
                  message: `Signal "${name}" written during render in ${compMatch[1]}. Move signal writes into event handlers, effects, or onMount().`,
                  line,
                  suggestedFix: `Move ${name}(...) into an effect() or event handler.`,
                });
              }
            }
          }
        }
      }
      return issues;
    },
  },
  {
    id: 'missing-key-in-for',
    code: 'ERR_MISSING_KEY',
    severity: 'warning',
    test(code) {
      const issues = [];
      // Match <For each={...}> without a key prop
      const forPattern = /<For\s+each=\{[^}]+\}\s*>/g;
      let match;
      while ((match = forPattern.exec(code)) !== null) {
        // Check if there's NO key= anywhere in the For tag
        // Get the full tag (up to the closing >)
        const tagStr = match[0];
        if (!tagStr.includes('key=') && !tagStr.includes('key ')) {
          const line = code.slice(0, match.index).split('\n').length;
          issues.push({
            severity: 'warning',
            code: 'ERR_MISSING_KEY',
            message: '<For> list rendered without a key prop. Add key={item => item.id} for efficient reordering.',
            line,
            suggestedFix: 'Add a key prop: <For each={items()} key={item => item.id}>',
          });
        }
      }

      // Also check mapArray without a key function (3rd arg)
      const mapPattern = /mapArray\s*\(\s*[^,]+,\s*[^,)]+\s*\)/g;
      while ((match = mapPattern.exec(code)) !== null) {
        // mapArray(source, mapFn) — missing the 3rd arg (keyFn)
        const line = code.slice(0, match.index).split('\n').length;
        issues.push({
          severity: 'warning',
          code: 'ERR_MISSING_KEY',
          message: 'mapArray() called without a key function (3rd argument). Add a key function for efficient list updates.',
          line,
          suggestedFix: 'Add a key function: mapArray(items, mapFn, item => item.id)',
        });
      }
      return issues;
    },
  },
  {
    id: 'prefer-computed-over-effect',
    code: 'HINT_PREFER_COMPUTED',
    severity: 'info',
    test(code) {
      const issues = [];
      // Find signal declarations
      const signalDecls = [...code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:signal|useSignal)\s*\(/g)];
      const signalNames = new Set(signalDecls.map(m => m[1]));

      // Find effects whose body is just a single signal write
      // Pattern: effect(() => { signalName(expression); })
      // or: effect(() => signalName(expression))
      const effectPattern = /effect\s*\(\s*\(\s*\)\s*=>\s*(?:\{\s*(\w+)\s*\([^)]+\)\s*;?\s*\}|(\w+)\s*\([^)]+\))\s*\)/g;
      let match;
      while ((match = effectPattern.exec(code)) !== null) {
        const writtenSignal = match[1] || match[2];
        if (writtenSignal && signalNames.has(writtenSignal)) {
          const line = code.slice(0, match.index).split('\n').length;
          issues.push({
            severity: 'info',
            code: 'HINT_PREFER_COMPUTED',
            message: `Effect only writes to signal "${writtenSignal}". Consider using computed() instead for lazy evaluation.`,
            line,
            suggestedFix: `Replace with: const ${writtenSignal} = computed(() => /* your expression */);`,
          });
        }
      }
      return issues;
    },
  },
];

// --- Scaffold Templates ---

const SCAFFOLD_TEMPLATES = {
  component: ({ name, props = [], signals = [] }) => {
    const propsParam = props.length > 0
      ? `{ ${props.join(', ')} }`
      : '';
    const signalDecls = signals.map(s => `  const ${s} = signal(${typeof s === 'string' && s.includes('is') ? 'false' : '""'}, '${s}');`).join('\n');

    return `import { signal, effect } from 'what-framework';

function ${name}(${propsParam}) {
${signalDecls || '  // Add signals here'}

  return (
    <div>
      <h2>${name}</h2>
      {/* Add your JSX here */}
    </div>
  );
}

export default ${name};
`;
  },

  page: ({ name, props = [], signals = [] }) => {
    const signalDecls = signals.map(s => `  const ${s} = signal(null, '${s}');`).join('\n');

    return `import { signal, effect, onMount } from 'what-framework';
import { Head } from 'what-framework';

function ${name}() {
${signalDecls || '  const loading = signal(true, \'loading\');'}

  onMount(() => {
    // Fetch data or initialize page
    loading(false);
  });

  return (
    <>
      <Head><title>${name}</title></Head>
      <main>
        <h1>${name}</h1>
        {/* Page content */}
      </main>
    </>
  );
}

export default ${name};
`;
  },

  form: ({ name, props = [], signals = [] }) => {
    const fields = signals.length > 0 ? signals : ['email', 'password'];
    const fieldDecls = fields.map(f => `    ${f}: { initial: '', rules: [rules.required('${f} is required')] },`).join('\n');

    return `import { signal } from 'what-framework';
import { useForm, Input, ErrorMessage, rules } from 'what-framework';

function ${name}() {
  const { fields, handleSubmit, isSubmitting, errors } = useForm({
    fields: {
${fieldDecls}
    },
    onSubmit: async (values) => {
      console.log('Form submitted:', values);
    },
  });

  return (
    <form onsubmit={handleSubmit}>
${fields.map(f => `      <div>
        <label for="${f}">${f.charAt(0).toUpperCase() + f.slice(1)}</label>
        <Input field={fields.${f}} id="${f}" type="text" />
        <ErrorMessage field={fields.${f}} />
      </div>`).join('\n')}
      <button type="submit" disabled={isSubmitting()}>
        {isSubmitting() ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  );
}

export default ${name};
`;
  },

  store: ({ name, signals = [] }) => {
    const stateFields = signals.length > 0
      ? signals.map(s => `    ${s}: null,`).join('\n')
      : '    items: [],\n    loading: false,\n    error: null,';

    return `import { createStore, derived } from 'what-framework';

const ${name.charAt(0).toLowerCase() + name.slice(1)} = createStore({
${stateFields}
});

// Derived values
// const itemCount = derived(state => state.items.length);

// Actions
export function addItem(item) {
  ${name.charAt(0).toLowerCase() + name.slice(1)}.set(state => ({
    ...state,
    items: [...state.items, item],
  }));
}

export function setLoading(value) {
  ${name.charAt(0).toLowerCase() + name.slice(1)}.set(state => ({ ...state, loading: value }));
}

export default ${name.charAt(0).toLowerCase() + name.slice(1)};
`;
  },

  island: ({ name, props = [], signals = [] }) => {
    const signalDecls = signals.map(s => `  const ${s} = signal(null, '${s}');`).join('\n');

    return `import { signal, effect, onMount } from 'what-framework';

// Island component — hydrates independently on the client.
// Server renders the static shell; this code runs only in the browser.
function ${name}(${props.length > 0 ? `{ ${props.join(', ')} }` : ''}) {
${signalDecls || '  const active = signal(false, \'active\');'}

  onMount(() => {
    // Client-only initialization
    console.log('${name} island hydrated');
  });

  return (
    <div data-island="${name.toLowerCase()}">
      {/* Interactive island content */}
    </div>
  );
}

// Mark as island for the compiler
${name}.island = true;

export default ${name};
`;
  },
};

// --- Register Agent Tools ---

export function registerAgentTools(server, bridge) {

  // Helper responses
  function errorResponse(message, nextSteps) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: message,
          summary: message,
          nextSteps: nextSteps || ['Check the arguments and try again.'],
        }, null, 2),
      }],
      isError: true,
    };
  }

  function ok(data) {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  function noConnection(tool) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'No browser connected',
          summary: `Cannot reach browser for ${tool}.`,
          nextSteps: [
            'Ensure your What Framework app is running with the devtools-mcp Vite plugin enabled.',
            'Check that the bridge server is started (default port 9229).',
          ],
        }, null, 2),
      }],
      isError: true,
    };
  }

  // -----------------------------------------------------------------------
  // Tool 1 — what_lint
  // -----------------------------------------------------------------------

  server.tool(
    'what_lint',
    'Static analysis for What Framework code. Pass a code snippet, get back structured issues with fix suggestions. Works offline — no browser connection needed.',
    {
      code: z.string().describe('The What Framework code snippet to analyze'),
      rules: z.array(z.string()).optional().describe('Specific rule IDs to run (default: all). Options: missing-signal-read, innerhtml-without-html, effect-writes-read-signal, missing-cleanup, signal-write-in-render, missing-key-in-for, prefer-computed-over-effect'),
    },
    async ({ code, rules: ruleFilter }) => {
      let rulesToRun = LINT_RULES;
      if (ruleFilter && ruleFilter.length > 0) {
        rulesToRun = LINT_RULES.filter(r => ruleFilter.includes(r.id));
        if (rulesToRun.length === 0) {
          return errorResponse(
            `No matching rules found. Available: ${LINT_RULES.map(r => r.id).join(', ')}`,
            ['Use one of the available rule IDs.']
          );
        }
      }

      const issues = [];
      for (const rule of rulesToRun) {
        try {
          const ruleIssues = rule.test(code);
          issues.push(...ruleIssues);
        } catch (e) {
          // Rule crashed — skip silently
        }
      }

      // Sort by line number
      issues.sort((a, b) => (a.line || 0) - (b.line || 0));

      const errorCount = issues.filter(i => i.severity === 'error').length;
      const warningCount = issues.filter(i => i.severity === 'warning').length;
      const summary = issues.length === 0
        ? 'No issues found. Code looks good.'
        : `${issues.length} issue${issues.length !== 1 ? 's' : ''}: ${errorCount} error${errorCount !== 1 ? 's' : ''}, ${warningCount} warning${warningCount !== 1 ? 's' : ''}.`;

      return ok({
        summary,
        issueCount: issues.length,
        errorCount,
        warningCount,
        issues,
        rulesChecked: rulesToRun.map(r => r.id),
      });
    }
  );

  // -----------------------------------------------------------------------
  // Tool 2 — what_scaffold
  // -----------------------------------------------------------------------

  server.tool(
    'what_scaffold',
    'Generate idiomatic What Framework boilerplate. Works offline — no browser connection needed.',
    {
      type: z.enum(['component', 'page', 'form', 'store', 'island']).describe('Type of code to generate'),
      name: z.string().describe('Name for the generated component/store (PascalCase recommended)'),
      props: z.array(z.string()).optional().describe('Prop names the component accepts'),
      signals: z.array(z.string()).optional().describe('Signal names to declare in the component'),
    },
    async ({ type, name, props, signals }) => {
      // Validate name is PascalCase
      if (!/^[A-Z]/.test(name) && type !== 'store') {
        return errorResponse(
          `Component name "${name}" should be PascalCase (e.g., "${name.charAt(0).toUpperCase() + name.slice(1)}").`,
          ['Use PascalCase for component names — this is required by the What Framework compiler.']
        );
      }

      const template = SCAFFOLD_TEMPLATES[type];
      if (!template) {
        return errorResponse(
          `Unknown scaffold type: ${type}`,
          [`Available types: ${Object.keys(SCAFFOLD_TEMPLATES).join(', ')}`]
        );
      }

      const code = template({ name, props: props || [], signals: signals || [] });

      return ok({
        summary: `Generated ${type} "${name}" with ${(signals || []).length} signals and ${(props || []).length} props.`,
        type,
        name,
        code,
        instructions: [
          `Save this as src/${type === 'page' ? 'pages/' : type === 'store' ? 'stores/' : 'components/'}${name}.jsx`,
          type === 'island' ? 'The island will hydrate independently on the client.' : null,
          type === 'store' ? 'Import the store in components that need shared state.' : null,
          type === 'form' ? 'Install zod if using zodResolver for validation.' : null,
        ].filter(Boolean),
      });
    }
  );

  // -----------------------------------------------------------------------
  // Tool 3 — what_validate
  // -----------------------------------------------------------------------

  server.tool(
    'what_validate',
    'Validate What Framework component code by running it through the compiler pipeline in the browser. Returns parse errors and compiled output.',
    {
      code: z.string().describe('Component code to validate'),
      format: z.enum(['esm', 'cjs']).optional().default('esm').describe('Output format (default: esm)'),
    },
    async ({ code, format }) => {
      if (!bridge.isConnected()) return noConnection('what_validate');

      try {
        const result = await bridge.sendCommand('validate-code', { code, format }, 10000);

        if (result.error) {
          return ok({
            valid: false,
            summary: `Validation failed: ${result.error}`,
            errors: result.errors || [{ message: result.error, line: result.line }],
            suggestions: result.suggestions || [
              'Check for syntax errors in the JSX.',
              'Ensure all imports are valid what-framework exports.',
            ],
          });
        }

        return ok({
          valid: true,
          summary: `Code is valid. Compiled to ${(result.output || '').length} chars of ${format}.`,
          output: result.output,
          warnings: result.warnings || [],
          stats: {
            signalCount: (result.output || '').match(/signal\s*\(/g)?.length || 0,
            effectCount: (result.output || '').match(/effect\s*\(/g)?.length || 0,
            componentCount: (result.output || '').match(/function\s+[A-Z]\w*\s*\(/g)?.length || 0,
          },
        });
      } catch (e) {
        // Fallback: do basic validation without browser
        const issues = [];

        // Check for basic syntax issues
        const openParens = (code.match(/\(/g) || []).length;
        const closeParens = (code.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
          issues.push({ message: `Mismatched parentheses: ${openParens} open, ${closeParens} close`, severity: 'error' });
        }

        const openBraces = (code.match(/\{/g) || []).length;
        const closeBraces = (code.match(/\}/g) || []).length;
        if (openBraces !== closeBraces) {
          issues.push({ message: `Mismatched braces: ${openBraces} open, ${closeBraces} close`, severity: 'error' });
        }

        // Run lint rules as fallback
        for (const rule of LINT_RULES) {
          try {
            issues.push(...rule.test(code));
          } catch { /* skip */ }
        }

        return ok({
          valid: issues.filter(i => i.severity === 'error').length === 0,
          summary: issues.length > 0
            ? `Found ${issues.length} issues (browser validation unavailable, used static analysis).`
            : 'No issues found via static analysis (browser validation unavailable).',
          errors: issues,
          note: 'Browser-based compiler validation was unavailable. Results are from static analysis only.',
        });
      }
    }
  );

  // -----------------------------------------------------------------------
  // Tool 4 — what_perf
  // -----------------------------------------------------------------------

  server.tool(
    'what_perf',
    'Performance snapshot of the running What Framework app. Signal count, effect count, hot effects, largest subscriber counts, memory estimate.',
    {
      threshold: z.number().optional().default(10).describe('Flag effects that ran more than this many times per second (default: 10)'),
    },
    async ({ threshold }) => {
      if (!bridge.isConnected()) return noConnection('what_perf');

      let snapshot;
      try {
        snapshot = bridge.getOrRefreshSnapshot
          ? await bridge.getOrRefreshSnapshot()
          : await bridge.refreshSnapshot();
      } catch {
        snapshot = bridge.getSnapshot();
      }

      if (!snapshot) {
        return errorResponse('No snapshot available.', [
          'Refresh the browser page to trigger a snapshot.',
        ]);
      }

      const signals = snapshot.signals || [];
      const effects = snapshot.effects || [];
      const components = snapshot.components || [];
      const recentEvents = bridge.getEvents(Date.now() - 1000); // last 1s

      // Hot effects: ran more than threshold times
      const hotEffects = effects
        .filter(e => (e.runCount || 0) > threshold)
        .sort((a, b) => (b.runCount || 0) - (a.runCount || 0))
        .slice(0, 20)
        .map(e => ({
          id: e.id,
          name: e.name || `effect_${e.id}`,
          runCount: e.runCount,
          depCount: (e.depSignalIds || e.deps || []).length,
          componentId: e.componentId,
        }));

      // Largest subscriber counts (signals with most effects depending on them)
      const subCounts = {};
      for (const eff of effects) {
        for (const sid of (eff.depSignalIds || eff.deps || [])) {
          subCounts[sid] = (subCounts[sid] || 0) + 1;
        }
      }
      const largestSubscribers = Object.entries(subCounts)
        .map(([id, count]) => {
          const sig = signals.find(s => s.id === Number(id));
          return { id: Number(id), name: sig?.name || `signal_${id}`, subscriberCount: count };
        })
        .sort((a, b) => b.subscriberCount - a.subscriberCount)
        .slice(0, 10);

      // Event rate
      const eventRate = recentEvents.length; // events per second

      // Memory estimate (rough heuristic)
      const signalMemory = signals.length * 200; // ~200 bytes per signal (value + subs set)
      const effectMemory = effects.length * 300; // ~300 bytes per effect (fn + deps array)
      const componentMemory = components.length * 500; // ~500 bytes per component
      const totalEstimate = signalMemory + effectMemory + componentMemory;
      const memoryStr = totalEstimate > 1048576
        ? `${(totalEstimate / 1048576).toFixed(1)} MB`
        : `${(totalEstimate / 1024).toFixed(1)} KB`;

      const issues = [];
      if (hotEffects.length > 0) {
        issues.push(`${hotEffects.length} effects exceeded ${threshold} runs (potential performance issue)`);
      }
      if (eventRate > 100) {
        issues.push(`High event rate: ${eventRate} events/sec`);
      }
      if (signals.length > 1000) {
        issues.push(`High signal count (${signals.length}) — consider consolidating with stores`);
      }

      const summary = issues.length > 0
        ? `Performance concerns: ${issues.join('; ')}.`
        : `Healthy. ${signals.length} signals, ${effects.length} effects, ${components.length} components. ${memoryStr} estimated.`;

      return ok({
        summary,
        counts: {
          signals: signals.length,
          effects: effects.length,
          components: components.length,
        },
        hotEffects,
        largestSubscribers,
        eventRate,
        memoryEstimate: memoryStr,
        memoryBytes: totalEstimate,
        issues,
        nextSteps: issues.length > 0 ? [
          'Use what_dependency_graph to trace hot effect dependencies.',
          'Consider using batch() to group signal writes.',
          'Use computed() for derived values instead of effects.',
        ] : [],
      });
    }
  );

  // -----------------------------------------------------------------------
  // Tool 5 — what_fix
  // -----------------------------------------------------------------------

  server.tool(
    'what_fix',
    'Given a What Framework error code, get diagnosis, suggested fix, and code example. Works offline — no browser needed.',
    {
      error: z.string().describe('Error code (e.g., "ERR_INFINITE_EFFECT") or error message text'),
    },
    async ({ error: errorInput }) => {
      // Try exact code match first
      let entry = ERROR_DATABASE[errorInput];

      // Try with ERR_ prefix
      if (!entry) {
        entry = ERROR_DATABASE[`ERR_${errorInput}`];
      }

      // Try fuzzy match on message text
      if (!entry) {
        const lower = errorInput.toLowerCase();
        for (const [code, def] of Object.entries(ERROR_DATABASE)) {
          if (lower.includes(code.toLowerCase().replace('err_', '').replace(/_/g, ' '))) {
            entry = def;
            break;
          }
        }
      }

      // Try keyword match
      if (!entry) {
        const lower = errorInput.toLowerCase();
        const keywordMap = {
          'infinite': 'ERR_INFINITE_EFFECT',
          'loop': 'ERR_INFINITE_EFFECT',
          'cycle': 'ERR_INFINITE_EFFECT',
          'signal read': 'ERR_MISSING_SIGNAL_READ',
          'missing ()': 'ERR_MISSING_SIGNAL_READ',
          'function]': 'ERR_MISSING_SIGNAL_READ',
          'hydration': 'ERR_HYDRATION_MISMATCH',
          'mismatch': 'ERR_HYDRATION_MISMATCH',
          'orphan': 'ERR_ORPHAN_EFFECT',
          'cleanup': 'ERR_MISSING_CLEANUP',
          'leak': 'ERR_MISSING_CLEANUP',
          'render': 'ERR_SIGNAL_WRITE_IN_RENDER',
          'innerhtml': 'ERR_UNSAFE_INNERHTML',
          'xss': 'ERR_UNSAFE_INNERHTML',
          'key': 'ERR_MISSING_KEY',
        };
        for (const [keyword, code] of Object.entries(keywordMap)) {
          if (lower.includes(keyword)) {
            entry = ERROR_DATABASE[code];
            break;
          }
        }
      }

      if (!entry) {
        return ok({
          found: false,
          summary: `No matching error code found for "${errorInput}".`,
          availableCodes: Object.keys(ERROR_DATABASE),
          suggestion: 'Try one of the available error codes, or paste the exact error message.',
        });
      }

      return ok({
        found: true,
        summary: `${entry.code}: ${entry.diagnosis.split('.')[0]}.`,
        error: entry.code,
        severity: entry.severity,
        diagnosis: entry.diagnosis,
        suggestedFix: entry.suggestedFix,
        codeExample: entry.codeExample,
      });
    }
  );
}
