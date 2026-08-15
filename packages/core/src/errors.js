// What Framework - Structured Error System
// Agent-first error reporting with actionable codes, suggestions, and JSON output.
// Every error tells an AI agent exactly what went wrong and how to fix it.

import { __DEV__ } from './reactive.js';

// --- Error Codes ---
// Each code maps to a specific, well-documented mistake pattern.

export const ERROR_CODES = {
  INFINITE_EFFECT: {
    code: 'ERR_INFINITE_EFFECT',
    severity: 'error',
    template: 'Effect "{{effectName}}" exceeded 25 flush iterations — likely an infinite loop.',
    suggestion: 'An effect is writing to a signal it also reads, creating a cycle. Use untrack() to read the signal without subscribing, or restructure so the write and read are in separate effects.',
    codeExample: `// Bad — reads and writes count, creating a cycle:
effect(() => { count(count() + 1); });

// Good — use untrack() so the read doesn't subscribe:
effect(() => { count(untrack(count) + 1); });

// Better — split into separate logic:
const doubled = computed(() => count() * 2);`,
  },

  MISSING_SIGNAL_READ: {
    code: 'ERR_MISSING_SIGNAL_READ',
    severity: 'warning',
    template: 'Signal "{{signalName}}" used without calling () — renders as "[Function]" instead of its value.',
    suggestion: 'Signals are functions. Call them to read: count() not count. In JSX: {count()} not {count}.',
    codeExample: `// Bad — signal reference, not value:
<span>{count}</span>       // renders "[Function]"

// Good — call the signal:
<span>{count()}</span>     // renders the actual value`,
  },

  HYDRATION_MISMATCH: {
    code: 'ERR_HYDRATION_MISMATCH',
    severity: 'error',
    template: 'Hydration mismatch in component "{{component}}": server rendered "{{serverHTML}}" but client expects "{{clientHTML}}".',
    suggestion: 'Ensure server and client render identical initial HTML. Avoid reading browser-only APIs (window, localStorage) during the initial render. Use onMount() for client-only logic.',
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

  ORPHAN_EFFECT: {
    code: 'ERR_ORPHAN_EFFECT',
    severity: 'warning',
    template: 'Effect "{{effectName}}" was created outside a reactive root — it will never be cleaned up.',
    suggestion: 'Wrap effect creation in createRoot() or create effects inside component functions where they are automatically tracked.',
    codeExample: `// Bad — orphaned, leaks memory:
effect(() => console.log(count()));

// Good — inside a root with cleanup:
createRoot(dispose => {
  effect(() => console.log(count()));
  // later: dispose() cleans up
});`,
  },

  SIGNAL_WRITE_IN_RENDER: {
    code: 'ERR_SIGNAL_WRITE_IN_RENDER',
    severity: 'error',
    template: 'Signal "{{signalName}}" written during render of component "{{component}}". This triggers re-execution.',
    suggestion: 'Move signal writes into event handlers, effects, or onMount(). The component body should only read signals, not write them.',
    codeExample: `// Bad — write during render:
function Counter() {
  count(count() + 1);  // triggers infinite loop
  return <span>{count()}</span>;
}

// Good — write in event handler:
function Counter() {
  return <button onclick={() => count(c => c + 1)}>{count()}</button>;
}`,
  },

  MISSING_CLEANUP: {
    code: 'ERR_MISSING_CLEANUP',
    severity: 'warning',
    template: 'Effect sets up "{{resource}}" but does not return a cleanup function.',
    suggestion: 'Effects that add event listeners, set timers, or open connections should return a cleanup function to prevent memory leaks.',
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

  UNSAFE_INNERHTML: {
    code: 'ERR_UNSAFE_INNERHTML',
    severity: 'warning',
    template: 'innerHTML set on element without using the __html safety marker.',
    suggestion: 'Use the html tagged template literal or pass { __html: content } to mark innerHTML as intentional and reviewed.',
    codeExample: `// Bad — raw innerHTML (XSS risk):
<div innerHTML={userInput} />

// Good — explicit opt-in:
<div innerHTML={{ __html: sanitizedContent }} />

// Better — use the html template literal:
html\`<div>\${sanitizedContent}</div>\``,
  },

  MISSING_KEY: {
    code: 'ERR_MISSING_KEY',
    severity: 'warning',
    template: 'List rendered without key prop in component "{{component}}". Items may re-order incorrectly.',
    suggestion: 'Add a unique key prop to each item in a list. Use a stable identifier (like an ID), not the array index.',
    codeExample: `// Bad — no key:
<For each={items()}>{item => <li>{item.name}</li>}</For>

// Good — stable key:
<For each={items()}>{item => <li key={item.id}>{item.name}</li>}</For>`,
  },

  UNSAFE_REDIRECT: {
    code: 'ERR_UNSAFE_REDIRECT',
    severity: 'error',
    template: 'redirect() refused an unsafe target: {{target}}.',
    suggestion: 'redirect() accepts same-origin paths and http:, https:, mailto: or tel: URLs only. Protocol-relative ("//host"), backslash-smuggled and javascript:/data: targets are open-redirect vectors. Check a user-supplied target against an allowlist first.',
    codeExample: `// Bad - a user-controlled target can leave your origin:
redirect(query.next);

// Good - allowlist the target first:
redirect(ALLOWED.has(query.next) ? query.next : '/');`,
  },

  REDIRECT_NOT_CAUGHT: {
    code: 'ERR_REDIRECT_NOT_CAUGHT',
    severity: 'error',
    template: 'A redirect() to "{{target}}" surfaced uncaught, so nothing performed the navigation.',
    suggestion: 'redirect() is caught in route middleware and in a component body. From an event handler, a promise callback, a timer or a reactive thunk, call navigate(to) instead. If the call is inside a try/catch, rethrow anything whose name is RouterRedirect. On the server this signal escapes renderToString to its caller: read its `to` and emit a 302 rather than calling navigate().',
    codeExample: `// Bad - a reactive thunk re-runs outside the render the Router caught:
<div>{() => (loggedOut() ? redirect('/login') : <Dashboard />)}</div>

// Good - navigate() from a thunk or a handler:
<div>{() => (loggedOut() ? (navigate('/login'), null) : <Dashboard />)}</div>
<button onclick={() => navigate('/login')}>Sign in</button>

// On the server, catch it instead of navigating:
try { html = renderToString(<App />); }
catch (e) { if (e.name === 'RouterRedirect') return Response.redirect(e.to, 302); throw e; }`,
  },
};

// --- WhatError ---
// Structured error class with full context for agent consumption.

export class WhatError extends Error {
  // codeExample carries the bad/good pair from the error's ERROR_CODES entry.
  // Every entry above already had one; the class simply dropped it on the
  // floor, so the field the docs promise on the serialized error was never
  // there and `suggestion` had to carry the whole fix in prose. It matters more
  // here than in a framework aimed at humans: the audience reading toJSON() is
  // usually an agent, and a diff-shaped example is the part it can copy.
  constructor({ code, message, suggestion, codeExample, file, line, component, signal, effect }) {
    super(message);
    this.name = 'WhatError';
    this.code = code;
    this.suggestion = suggestion;
    this.codeExample = codeExample;
    this.file = file;
    this.line = line;
    this.component = component;
    this.signal = signal;
    this.effect = effect;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      suggestion: this.suggestion,
      codeExample: this.codeExample,
      file: this.file,
      line: this.line,
      component: this.component,
      signal: this.signal,
      effect: this.effect,
    };
  }
}

// --- Error Factory ---
// Create WhatError instances from error codes with template interpolation.

export function createWhatError(errorCode, context = {}) {
  const def = typeof errorCode === 'string' ? ERROR_CODES[errorCode] : errorCode;
  if (!def) {
    return new WhatError({
      code: 'ERR_UNKNOWN',
      message: `Unknown error: ${errorCode}`,
      suggestion: 'Check the error code and try again.',
    });
  }

  // Interpolate template with context values
  let message = def.template;
  for (const [key, val] of Object.entries(context)) {
    message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
  }
  // Clean up any unreplaced placeholders
  message = message.replace(/\{\{[^}]+\}\}/g, '(unknown)');

  return new WhatError({
    code: def.code,
    message,
    suggestion: def.suggestion,
    // Verbatim from the definition: codeExample is a worked bad/good pair, not
    // a template, so there is nothing in it to interpolate.
    codeExample: def.codeExample,
    file: context.file,
    line: context.line,
    component: context.component,
    signal: context.signal || context.signalName,
    effect: context.effect || context.effectName,
  });
}

// --- Error Collector ---
// Dev-mode error accumulator for agent retrieval.

let collectedErrors = [];
const MAX_COLLECTED = 200;

export function collectError(whatError) {
  if (!__DEV__) return;
  collectedErrors.push({
    ...whatError.toJSON(),
    timestamp: Date.now(),
  });
  if (collectedErrors.length > MAX_COLLECTED) {
    collectedErrors = collectedErrors.slice(-MAX_COLLECTED);
  }
}

export function getCollectedErrors(since) {
  if (since) return collectedErrors.filter(e => e.timestamp > since);
  return collectedErrors.slice();
}

export function clearCollectedErrors() {
  collectedErrors = [];
}

// --- Error Classification ---
// Classify a raw Error into a structured WhatError if possible.

export function classifyError(err, context = {}) {
  const msg = err?.message || String(err);

  // Infinite effect loop
  if (msg.includes('infinite effect loop') || msg.includes('25 iterations')) {
    return createWhatError('INFINITE_EFFECT', context);
  }

  // Hydration mismatch
  if (msg.includes('hydration') || msg.includes('Hydration')) {
    return createWhatError('HYDRATION_MISMATCH', context);
  }

  // Signal write in computed
  if (msg.includes('Signal.set() called inside a computed')) {
    return createWhatError('SIGNAL_WRITE_IN_RENDER', {
      ...context,
      signalName: msg.match(/signal: (\w+)/)?.[1] || context.signalName,
    });
  }

  // Fallback — return a generic WhatError with the original message
  return new WhatError({
    code: 'ERR_RUNTIME',
    message: msg,
    suggestion: 'Check the stack trace and component context for more details.',
    ...context,
  });
}
