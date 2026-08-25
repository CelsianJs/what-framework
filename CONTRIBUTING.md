# Contributing to What Framework

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/CelsianJs/what-framework.git
cd what-framework
npm install
npm test  # 2,500+ tests should pass
```

Two maps, and they answer different questions:

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — where code lives. The package graph,
  what each directory is for, which gate protects what, which CI is
  authoritative. Read this before changing something.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how the framework works.
  The mental model, the rendering pipeline, islands, the MCP bridge. Read this
  before changing something in core.

The repo is a monorepo with packages in `packages/`:

| Package | Description |
|---------|-------------|
| `what-core` | Signals, reactivity, components, hooks |
| `what-router` | Client-side routing with file-based routes |
| `what-server` | SSR, islands architecture, server actions |
| `what-isr` | Origin-first ISR cache engine |
| `what-compiler` | JSX compiler (Babel + Vite plugin) |
| `what-framework` | Umbrella package re-exporting all of the above |
| `what-text` | Optional text engine (`@chenglou/pretext`) |
| `create-what` | Project scaffolder (`npx create-what`) |
| `what-react` | React compatibility layer |
| `what-framework-cli` | CLI tools |
| `eslint-plugin-what` | ESLint rules for What |
| `what-devtools` | Browser devtools |
| `what-devtools-mcp` | MCP-based AI debugging bridge |
| `what-mcp` | MCP documentation server |

## Running Tests

```bash
npm test          # 173 test files, Node's built-in runner
npm run test:stress   # adversarial cases outside the unit suite
```

Tests use Node's built-in test runner. No external test framework needed.

`npm run release:verify` runs every gate in order. Individually:

| Command | What it protects |
|---|---|
| `npm run lint` | The framework passes its own ESLint rules |
| `npm run typecheck` | The hand-written `.d.ts` files compile |
| `npm run typecheck:src` | `allowJs` + `checkJs` over every implementation file |
| `npm run hygiene:types` | Declarations and runtime exports match, both directions |
| `npm run hygiene:publish` | Export maps resolve, tarballs are complete, packed types typecheck in a clean consumer |
| `npm run check:error-codes` | Every thrown `ERR_*` is catalogued |
| `npm run check:size` | Bundle budgets in `.size-budgets.json` |
| `npm run test:prod` | The production build is not a blank screen |
| `npm run bench:gate` | Performance has not regressed |
| `npm run smoke:scaffold` | `create-what` produces something that runs |
| `npm run smoke:apps` | Four real apps in a real browser, 84 checks |

### Shared test helpers

`test-utils/` holds the setup that every test used to reinvent. Use them in new
tests rather than hand-rolling a JSDOM:

```js
import { installDOM } from '../../../test-utils/dom.js';

// Before importing framework modules: several of them read `typeof document`
// at module scope to decide whether they are on a server.
const { document, cleanup } = installDOM();
const { mount } = await import('../src/dom.js');
```

```js
import { compileJSX } from '../../../test-utils/compile.js';

const out = compileJSX('<div>{count()}</div>');
```

`installDOM()` installs one environment every time. That is the point: 68 test
files were wiring globals by hand and disagreeing about which ones, so a file
that omitted `SVGElement` and then rendered an `<svg>` was testing a different
environment from the one next to it. Two files keep their own setup on purpose
and say why in a comment.

**A bug fix needs a test that fails without the fix.** Say so in the PR, with
the count. A test written from the shape of the patch rather than the shape of
the bug passes either way, which is the same as having no test.

## Git & PR Workflow

### Branches

- `main` is the production branch. **Never push directly to main.**
- Create branches from `main` with descriptive names:
  - `fix/issue-N-short-description` — bug fixes (reference the issue number)
  - `feat/short-description` — new features
  - `chore/short-description` — maintenance, refactoring, docs

### Commits

Use [conventional commits](https://www.conventionalcommits.org/):
- `fix(compiler): description` — bug fix
- `feat(core): description` — new feature
- `chore(benchmark): description` — maintenance
- `docs: description` — documentation only

Scope is the package name: `compiler`, `core`, `router`, `server`, `devtools`, `benchmark`, etc.

### Pull Requests

Every change goes through a PR. The process:

1. Create a branch from `main`
2. Make changes, add tests for new functionality
3. Run `npm test` — all tests must pass
4. Push the branch and open a PR
5. PR title uses the same conventional commit format
6. PR body must include:
   - **Summary** — what changed and why (bullet points)
   - **Test plan** — how the changes were verified (checkboxes)
7. **Connect to issues** — use `Closes #N` or `Fixes #N` in the PR body to auto-close issues on merge
8. Squash merge into `main`
9. Delete the branch after merge

### Issues

- File bugs with reproduction steps, expected vs actual behavior, and environment info
- Reference related issues when they share root causes
- Close issues via PR merge (`Closes #N`), not manually
- If multiple issues share a root cause, one PR can close all of them

### Publishing to npm

Publishing is normally done from the GitHub `Release And Deploy` workflow on
`main`, not from a contributor machine. After merging:

1. Bump versions in affected `package.json` files (core, compiler, what-framework are usually coupled)
2. `npm run release:verify` — run correctness, size, production, benchmark, and scaffold gates
3. Open/merge a release PR
4. Trigger the GitHub `Release And Deploy` workflow with `publish_packages=true`
5. Confirm `npm run verify:registry` passed in CI and all public package versions match npm

The publish script handles dependency ordering and skips already-published versions.
Local publish is emergency-only and still requires a fresh `npm run release:verify`,
`node scripts/publish-packages.mjs --dry-run`, and post-publish `npm run verify:registry`.

## Code Style

- No build step for source -- packages ship raw ES modules from `src/`
- Event handlers are lowercase: `onclick`, `oninput` (not camelCase)
- Signals use unified getter/setter: `sig()` reads, `sig.set(value)` writes
- Reactive children in JSX: `{() => count()}` for text, `{() => items().map(...)}` for lists

---

## Adding MCP Tools

The framework ships two MCP servers. When adding tools, follow these patterns:

### Documentation MCP (`packages/mcp-server/`)

The documentation server provides static content. To add a new documentation topic:

1. Add the content string to the `DOCS` object in `packages/mcp-server/src/index.js`
2. Add a tool entry in the `ListToolsRequestSchema` handler
3. Add a case in the `CallToolRequestSchema` switch

```js
// In DOCS object:
myTopic: `
## My Topic
Content here with code examples.
`,

// In tools list:
{
  name: 'what_my_topic',
  description: 'Learn about my topic',
  inputSchema: { type: 'object', properties: {}, required: [] },
},

// In handler switch:
case 'what_my_topic':
  return { content: [{ type: 'text', text: DOCS.myTopic }] };
```

### DevTools MCP (`packages/devtools-mcp/`)

The DevTools server connects to a running browser app. Tools go in either `tools.js` (core) or `tools-extended.js` (extended).

Every tool response must include:
- A `summary` string (one-line description of what was found)
- Structured data for deeper inspection
- `nextSteps` array when errors occur (tells the agent what to do next)

```js
server.tool(
  'what_my_tool',
  'One-line description of what this tool does',
  {
    param: z.string().describe('What this parameter does'),
  },
  async ({ param }) => {
    if (!bridge.isConnected()) return noConnection('what_my_tool');
    const snapshot = await bridge.getOrRefreshSnapshot();
    if (!snapshot) return noSnapshot();

    // ... your logic ...

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          summary: 'What was found',
          // ... structured data ...
        }, null, 2),
      }],
    };
  }
);
```

If the tool needs browser-side execution, add a command handler in `client-commands.js`.

---

## Adding Error Codes

Every error the framework raises carries a stable `ERR_*` code, and every code
is catalogued once in `packages/core/src/errors.js` with a severity, a
suggestion and a worked bad/good example. The `what_errors` MCP tool reads that
catalogue, so the audience is usually an agent.

**1. Add the entry to `ERROR_CODES`:**

```js
ISLAND_STORE_OUTSIDE_RENDER: {
  code: 'ERR_ISLAND_STORE_OUTSIDE_RENDER',   // ERR_UPPER_SNAKE, unique
  severity: 'error',                          // 'error' | 'warning'
  template: '[what-server] Island store "{{name}}" was accessed outside an active server render.',
  suggestion: 'A module-scoped island store resolves against the current request, so ...',
  codeExample: `// Bad - runs at import time, with no request in scope:
const count = cart.items.length;

// Good - read it inside a component the server is rendering:
function Cart() { return <span>{cart.items.length}</span>; }`,
},
```

**2. Throw it.** Inside what-core, `createWhatError('KEY', context)` builds the
message from the template. Everywhere else, attach **only the code**:

```js
// ERROR_CODES.ISLAND_STORE_OUTSIDE_RENDER
throw Object.assign(new Error(`[what-server] Island store "${name}" ...`), {
  code: 'ERR_ISLAND_STORE_OUTSIDE_RENDER',
});
```

That split is deliberate and it is a size decision. Importing
`createWhatError()` into a client-shipped module retains the whole catalogue
through the bundler — measured at 6 KB gzipped on what-server's action
surface. `classifyError(err)` resolves a code back to its suggestion and
example, so nothing is lost. It is also the only rule that works for the
packages that cannot import core at all: what-isr, the compiler, the MCP
server, and the CLI.

**3. `npm run check:error-codes`** asserts every `ERR_*` literal under
`packages/*/src` is catalogued, that codes are unique, and that every entry has
a suggestion. It runs in CI.

## Adding Guardrails

Guardrails are dev-mode checks that catch common mistakes. They run only when `process.env.NODE_ENV !== 'production'`.

Guardrail categories:
- **Signal misuse**: Reading without `()`, mutating in place
- **Missing reactive wrapper**: Passing signal reference instead of value
- **Stale closure**: Signal read outside reactive context
- **API misuse**: Using removed APIs (`show()`), wrong error accessor pattern

When adding a guardrail:

1. Add the check in the relevant source file (e.g. `reactive.js` for signal checks)
2. Wrap it in `if (__DEV__) { ... }` — the shared flag from `reactive.js`, not a
   raw `process.env` read. `__DEV__` resolves from `globalThis.__WHAT_DEV__`,
   then `import.meta.env.DEV`, then `process.env`, so it works in a bundler, in
   a browser and in Node; a raw `process.env` read works in none of them
   reliably and does not get stripped from the production build.
3. Give it a code from the catalogue above, so an agent can look up the fix
4. Add an ESLint rule in `eslint-plugin-what` if it can be caught statically
5. Document it in [docs/GOTCHAS.md](docs/GOTCHAS.md)

---

## Continuous Integration

**`.depot/workflows/` is authoritative.** CI has run on Depot since 2026-07-11.

`.github/workflows/` holds a copy of each workflow with its triggers reduced to
`workflow_dispatch`, kept as a manual fallback if Depot is unavailable. The two
sets are not generated from each other and they will drift, so:

> Change the Depot copy first, then mirror the change into the GitHub copy in
> the same PR.

The four workflows are `ci`, `size`, `benchmarks` and `release-and-deploy`.

## Code of Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting Issues

Open an issue at [github.com/CelsianJs/what-framework/issues](https://github.com/CelsianJs/what-framework/issues). Include:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (Node version, OS, browser)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
