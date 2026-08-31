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

  // --- Outside core ---
  //
  // Every package in the workspace threw bare `new Error(...)` with good prose
  // and no code, so nothing downstream could branch on the failure and the
  // what_errors MCP tool could only ever enumerate core's own. The entries
  // below are the catalogue for the rest of the framework.
  //
  // These are catalogued here but NOT constructed here. A throw outside core
  // carries only its `code`; the suggestion and the worked example live once,
  // in this file, and are resolved from the code by classifyError() or by
  // reading ERROR_CODES directly.
  //
  // That split is a size decision, and it was measured. Importing
  // createWhatError() into what-server's client-shipped action surface retains
  // this whole catalogue through the bundler: esbuild took that surface from
  // 8.4 KB minified / 3.5 KB gzipped to 25.9 KB / 9.7 KB. Six kilobytes of
  // gzipped prose in every visitor's browser is the wrong trade for making
  // three server-side messages structured.
  //
  // The same rule keeps the packages that genuinely cannot import core honest:
  // what-isr never imports what-server, which is what keeps it usable from any
  // adapter; the compiler runs inside Babel at build time; the MCP server has
  // no framework dependency; and the CLI loads the project's runtime, not its
  // own. `scripts/check-error-codes.mjs` asserts every `ERR_*` literal thrown
  // anywhere under packages/*/src appears here, so nothing drifts.

  NO_SECURE_RANDOM: {
    code: 'ERR_NO_SECURE_RANDOM',
    severity: 'error',
    template: '[what] No secure random source available for CSRF token generation.',
    suggestion: 'Neither globalThis.crypto.getRandomValues nor node:crypto was reachable. On Node this means a build older than 18 or a bundler that stripped node:crypto; on an edge runtime it means the Web Crypto global was not provided. A CSRF token from Math.random is not a token, so this refuses rather than degrading.',
    codeExample: `// Node 18+ exposes Web Crypto globally; nothing to configure.
// If a bundler dropped it, restore the global before creating the server:
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;`,
  },

  ACTION_FAILED: {
    code: 'ERR_ACTION_FAILED',
    severity: 'error',
    template: '{{message}}',
    suggestion: 'The server action rejected. The message is the one the action threw, forwarded to the client by the action handler. Throw a typed error from the action and branch on its shape rather than parsing this string.',
    codeExample: `// In the action, fail with something the client can read:
export const save = action(async (data) => {
  if (!data.email) throw Object.assign(new Error('Email required'), { field: 'email' });
});`,
  },

  STATIC_WRITE_ESCAPE: {
    code: 'ERR_STATIC_WRITE_ESCAPE',
    severity: 'error',
    template: '[what-server] Refusing to write outside outDir: {{path}}.',
    suggestion: 'A route path resolved to a location outside the export directory, which a "../" segment in a route or a param can do. Sanitize the route path, or drop the route from the static export.',
    codeExample: `// Bad — a param that can contain a slash escapes outDir:
{ path: '/docs/:slug*', mode: 'static' }

// Good — constrain the param, or precompute the exact paths:
{ path: '/docs/:slug', mode: 'static', paths: () => slugs.map(slug => ({ slug })) }`,
  },

  INVALID_HTML_NESTING: {
    code: 'ERR_INVALID_HTML_NESTING',
    severity: 'error',
    template: '<{{parent}}> cannot contain <{{child}}>: the HTML parser closed the outer tag early, so the rendered tree does not match your JSX.',
    suggestion: 'The compiler turns each element into an HTML template string, and the browser parses it under real HTML rules. Some nestings are not expressible: <p> may only hold phrasing content, <a> may not hold another <a>, and a table section may not hold arbitrary elements. The parser silently reorders them, which leaves compiled output walking a tree that no longer matches your source. Change the outer tag (usually <p> to <div>) or move the child out.',
    codeExample: `// Bad — the parser closes <p> before <div>, producing four sibling nodes:
<p>Intro<div>{body()}</div>Outro</p>

// Good — a block container can hold block content:
<div class="prose">Intro<div>{body()}</div>Outro</div>

// Good — or keep the paragraph and use phrasing content:
<p>Intro<span>{body()}</span>Outro</p>`,
  },

  INVALID_SSR_TAG: {
    code: 'ERR_INVALID_SSR_TAG',
    severity: 'error',
    template: '[what-server] Invalid tag name in SSR: {{tag}}.',
    suggestion: 'renderToString reached a vnode whose tag is neither a string nor a component function. This is almost always a component that returned a raw object, or a value interpolated where an element was expected.',
    codeExample: `// Bad — returns a plain object, not a vnode:
function Row() { return { name: 'a' }; }

// Good — return elements, and interpolate values as children:
function Row({ name }) { return <li>{name}</li>; }`,
  },

  COMPILED_JSX_IN_SSR: {
    code: 'ERR_COMPILED_JSX_IN_SSR',
    severity: 'error',
    template: 'what-compiler output cannot be server-rendered: {{file}}.',
    suggestion: 'what-compiler lowers JSX to module-scope _$template() calls that run document.createElement() at import time, and to _$createComponent() which builds DOM. Neither has a server-rendered form, so a module it compiled throws "document is not defined" when a server imports it. Server-rendered views have two supported spellings: author them with h(), or compile them with the automatic JSX runtime (jsxImportSource: "what-framework"), which emits h() calls that renderToString understands. what-compiler stays on the client entry, where the fine-grained output is the point.',
    codeExample: `// Bad — a server module compiled by what-compiler:
// vite.config.js: plugins: [what()]  +  vite build --ssr
export function Page() { return <h1>Hi</h1>; }   // throws on import

// Good — h(), which renderToString understands:
import { h } from 'what-framework';
export function Page() { return h('h1', null, 'Hi'); }

// Good — the automatic JSX runtime for the server build:
// vite.config.js (server): esbuild: { jsx: 'automatic',
//                            jsxImportSource: 'what-framework' }
export function Page() { return <h1>Hi</h1>; }   // lowers to h()`,
  },

  FORM_ACTION_NOT_REGISTERED: {
    code: 'ERR_FORM_ACTION_NOT_REGISTERED',
    severity: 'error',
    template: '[what] <Form action={fn}>: that function is not a server action.',
    suggestion: 'Wrap it with action() from what-server, or pass the action id as a string. A plain function has no id, so there is nothing for the form post to address.',
    codeExample: `// Bad — a plain function:
async function save(data) {}
<Form action={save} />

// Good — a registered action:
export const save = action(async (data) => {});
<Form action={save} />`,
  },

  FORM_ACTION_MISSING: {
    code: 'ERR_FORM_ACTION_MISSING',
    severity: 'error',
    template: '[what] <Form> requires an `action` prop: a server action or its id.',
    suggestion: 'Pass the action itself, or the string id it was registered under.',
    codeExample: `// Bad:
<Form method="post" />

// Good:
<Form action={save} />
<Form action="save-user" />`,
  },

  ISLAND_STORE_OUTSIDE_RENDER: {
    code: 'ERR_ISLAND_STORE_OUTSIDE_RENDER',
    severity: 'error',
    template: '[what-server] Island store "{{name}}" was accessed outside an active server render.',
    suggestion: 'A module-scoped island store resolves against the current request, so it can only be read or written from a component rendered by renderDocument/renderPage. Reading one at module scope, or from a background task, has no request to bind to.',
    codeExample: `// Bad — runs at import time, with no request in scope:
const count = cart.items.length;

// Good — read it inside a component the server is rendering:
function Cart() { return <span>{cart.items.length}</span>; }`,
  },

  ISR_MISSING_CLIENT: {
    code: 'ERR_ISR_MISSING_CLIENT',
    severity: 'error',
    template: '[what-isr] createRedisStore requires { client }.',
    suggestion: 'what-isr ships no Redis driver on purpose, so the client is injected. Pass an ioredis or node-redis instance (get/set/del/sadd/srem/smembers, optionally expire/scan/keys).',
    codeExample: `import Redis from 'ioredis';
const store = createRedisStore({ client: new Redis(process.env.REDIS_URL) });`,
  },

  ISR_VARY_UNRESOLVED: {
    code: 'ERR_ISR_VARY_UNRESOLVED',
    severity: 'error',
    template: '[what-isr] cannot build a cache key: `vary` is declared but could not be resolved against the request.',
    suggestion: 'A declared vary is a list of names that must be resolved against real request headers before it can be part of a key. Either pass the request headers alongside the declaration, or pass an already-resolved name -> value object. Guessing would cache one visitor page under another visitor key.',
    codeExample: `// Bad — a declaration with nothing to resolve it against:
cacheKey({ path, vary: ['cookie:session'] });

// Good — supply the headers:
cacheKey({ path, vary: ['cookie:session'], headers: request.headers });

// Good — or resolve it yourself:
cacheKey({ path, vary: { 'cookie:session': sessionId } });`,
  },

  ISR_VARY_NO_HEADERS: {
    code: 'ERR_ISR_VARY_NO_HEADERS',
    severity: 'error',
    template: '[what-isr] route declares `vary` but the adapter supplied no request headers; refusing to cache.',
    suggestion: 'The route varies its output per header, and the adapter called the engine without them. Caching anyway would serve one variant to every request. Forward the request headers from the adapter into the engine call.',
    codeExample: `// In the adapter:
await engine.handle(routeMatch, { headers: request.headers });`,
  },

  DUPLICATE_ACTION_ID: {
    code: 'ERR_DUPLICATE_ACTION_ID',
    severity: 'error',
    template: 'Duplicate server action ID "{{id}}".',
    suggestion: 'Action ids are the wire address of a server action, so two actions cannot share one. Ids derive from the file path and export name, so this usually means the same action is being registered twice, or an explicit id was reused.',
    codeExample: `// Bad — two actions pinned to the same id:
export const save = action(fn, { id: 'save' });
export const store = action(fn, { id: 'save' });

// Good — let ids derive, or make them distinct:
export const save = action(fn);
export const store = action(fn, { id: 'store-user' });`,
  },

  PAGE_NO_DEFAULT_EXPORT: {
    code: 'ERR_PAGE_NO_DEFAULT_EXPORT',
    severity: 'error',
    template: 'Page module has no default-exported component.',
    suggestion: 'A page file must default-export the component to render. A named export cannot be found by the file-router.',
    codeExample: `// Bad:
export function Home() { return <h1>Hi</h1>; }

// Good:
export default function Home() { return <h1>Hi</h1>; }`,
  },

  HOOK_OUTSIDE_RENDER: {
    code: 'ERR_HOOK_OUTSIDE_RENDER',
    severity: 'error',
    template: '[what-react] {{hookName}}() called outside of a component render.',
    suggestion: 'Hooks can only be called while a what-react component is rendering. When this happens inside a React library, the usual cause is two module instances: make sure every `react` and `react-dom` import is aliased to what-react by the reactCompat() vite plugin.',
    codeExample: `// vite.config.js
import { reactCompat } from 'what-react/vite';
export default { plugins: [reactCompat()] };`,
  },

  CHILDREN_ONLY: {
    code: 'ERR_CHILDREN_ONLY',
    severity: 'error',
    template: 'React.Children.only expected to receive a single React element child.',
    suggestion: 'Children.only asserts exactly one element. Pass one child, or use Children.toArray/Children.map when the count can vary.',
    codeExample: `// Bad:
<Tooltip><span>a</span><span>b</span></Tooltip>

// Good:
<Tooltip><span>a</span></Tooltip>`,
  },

  USE_INVALID_ARG: {
    code: 'ERR_USE_INVALID_ARG',
    severity: 'error',
    template: '[what-react] use() expects a promise or a context.',
    suggestion: 'use() reads either a thenable or a context object. Anything else has nothing to suspend on or subscribe to.',
    codeExample: `// Good:
const value = use(ThemeContext);
const data = use(fetchUser(id));`,
  },

  PRETEXT_NOT_INSTALLED: {
    code: 'ERR_PRETEXT_NOT_INSTALLED',
    severity: 'error',
    template: '[what-text] Failed to load @chenglou/pretext: {{message}}.',
    suggestion: 'what-text declares pretext as an optional peer so the package installs without it. Install it to use the text engine: npm install @chenglou/pretext',
    codeExample: `npm install @chenglou/pretext`,
  },

  DESTRUCTURED_PROPS: {
    code: 'ERR_DESTRUCTURED_PROPS',
    severity: 'warning',
    template: "Destructuring '{{binding}}' in the component body snapshots props and loses reactivity.",
    suggestion: "What components run ONCE, so the body is not re-run when a prop changes. Reading `props.foo` goes through the reactive proxy and tracks; `const { foo } = props` reads the value once and detaches it. Read through the proxy inside JSX and effects, or wrap each field in an accessor.",
    codeExample: `// Bad - snapshots at first run, never updates:
function Row(props) {
  const { label } = props;
  return <span>{label}</span>;
}

// Good - reads through the proxy each time:
function Row(props) {
  return <span>{props.label}</span>;
}

// Good - an accessor keeps the destructured name:
function Row(props) {
  const label = () => props.label;
  return <span>{label()}</span>;
}`,
  },

  // --- Fallbacks ---
  // classifyError() returns one of these when a raw Error does not match any
  // known pattern. They are catalogued so what_errors never reports a code an
  // agent cannot look up.

  RUNTIME: {
    code: 'ERR_RUNTIME',
    severity: 'error',
    template: '{{message}}',
    suggestion: 'An error surfaced that the framework could not classify, so the message is the original one verbatim. The stack, file and line on the error narrow it; if the same shape shows up repeatedly it is worth its own code here.',
    codeExample: `// Inspect the structured form rather than the string:
try { render(); } catch (e) { console.log(classifyError(e).toJSON()); }`,
  },

  UNKNOWN: {
    code: 'ERR_UNKNOWN',
    severity: 'error',
    template: 'Unknown error: {{errorCode}}.',
    suggestion: 'createWhatError() was called with a code that is not in this catalogue. Check the spelling against ERROR_CODES, or add the entry.',
    codeExample: `// Bad - not a catalogue key:
createWhatError('MISSING_KEYS');

// Good:
createWhatError('MISSING_KEY', { component: 'TodoList' });`,
  },

  UNKNOWN_TOOL: {
    code: 'ERR_UNKNOWN_TOOL',
    severity: 'error',
    template: 'Unknown tool: {{name}}.',
    suggestion: 'The MCP client called a tool this server does not expose. Call tools/list to enumerate what is available; a stale client cache is the usual cause.',
    codeExample: `// List what the server actually exposes:
{ "method": "tools/list" }`,
  },
};

// Reverse index: an error carries `code: 'ERR_X'`, and the catalogue is keyed
// by its short name.
//
// Built on first use, NOT at module load. A top-level `new Map(...)` over
// ERROR_CODES is a side effect that references the catalogue, which pins it
// into every bundle that imports what-core: it took the counter app from
// 6.4 KB gzipped to 12.1 KB and tripped check:size. Inside a function, a
// bundler that drops getErrorDefinition drops the catalogue with it.
/** @type {Map<string, any> | null} */
let _codeIndex = null;

/** Look up a catalogue entry by its `ERR_*` code. Returns undefined if unknown. */
export function getErrorDefinition(code) {
  if (_codeIndex === null) {
    _codeIndex = new Map(Object.values(ERROR_CODES).map((def) => [def.code, def]));
  }
  return _codeIndex.get(code);
}

// --- WhatError ---
// Structured error class with full context for agent consumption.

export class WhatError extends Error {
  // codeExample carries the bad/good pair from the error's ERROR_CODES entry.
  // Every entry above already had one; the class simply dropped it on the
  // floor, so the field the docs promise on the serialized error was never
  // there and `suggestion` had to carry the whole fix in prose. It matters more
  // here than in a framework aimed at humans: the audience reading toJSON() is
  // usually an agent, and a diff-shaped example is the part it can copy.
  /**
   * @param {object} init
   * @param {string} init.code
   * @param {string} [init.message]
   * @param {string} [init.suggestion]
   * @param {{ bad?: string, good?: string } | string} [init.codeExample]
   * @param {string} [init.file]
   * @param {number} [init.line]
   * @param {string} [init.component]
   * @param {string} [init.signal]
   * @param {string} [init.effect]
   */
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

  // An error the framework threw already says what it is. Every throw outside
  // core carries a `code` and nothing else — the suggestion and the worked
  // example live once, in ERROR_CODES — so resolving the code here is what
  // makes them reachable at all. Message sniffing below is only for errors
  // that predate the code, or that come from user code.
  if (err && typeof err.code === 'string') {
    const def = getErrorDefinition(err.code);
    if (def) {
      return new WhatError({
        code: def.code,
        // The thrown message is the specific one; the template is generic.
        message: msg,
        suggestion: def.suggestion,
        codeExample: def.codeExample,
        file: context.file,
        line: context.line,
        component: context.component,
        signal: context.signal || context.signalName,
        effect: context.effect || context.effectName,
      });
    }
  }

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
