# Contributing to What Framework

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/CelsianJs/what-framework.git
cd whatfw
npm install
npm test  # 653+ tests should pass
```

The repo is a monorepo with packages in `packages/`:

| Package | Description |
|---------|-------------|
| `what-core` | Signals, reactivity, components, hooks |
| `what-router` | Client-side routing with file-based routes |
| `what-server` | SSR, islands architecture, server actions |
| `what-compiler` | JSX compiler (Babel + Vite plugin) |
| `what-framework` | Umbrella package re-exporting all of the above |
| `create-what` | Project scaffolder (`npx create-what`) |
| `what-react` | React compatibility layer |
| `what-framework-cli` | CLI tools |
| `eslint-plugin-what` | ESLint rules for What |
| `what-devtools` | Browser devtools |
| `what-devtools-mcp` | MCP-based AI debugging bridge |
| `what-mcp` | MCP documentation server |

## Running Tests

```bash
npm test          # Run all tests
```

Tests use Node's built-in test runner. No external test framework needed.

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

After merging a normal mainline/latest release:

1. Bump the public packages being released above the current npm `latest` version; mainline releases should keep coupled packages on the same version
2. `npm run build` — rebuild dist
3. `npm test` — verify all tests still pass
4. `npm run pack:smoke` — verify packed packages install in a clean consumer project
5. `node scripts/publish-packages.mjs --dry-run` — verify what will be published
6. `node scripts/publish-packages.mjs --otp <code>` — publish with 2FA code

The publish script handles dependency ordering and skips already-published versions. It refuses to publish a version that is not greater than npm `latest` unless the release uses an explicit non-`latest` dist-tag and `--allow-non-latest`. Mainline/latest releases are same-version releases; 0.6.x backports are intentionally staggered by changed package.

#### Backport publishes

For `0.6.x` maintenance/backport releases, do **not** publish to the `latest` dist-tag and do not force-bump unchanged packages. Use the dedicated backport channel and keep the acknowledgement flag visible in both dry-runs and the actual publish:

```bash
node scripts/publish-packages.mjs --dry-run --tag backport --allow-non-latest
node scripts/publish-packages.mjs --tag backport --allow-non-latest --otp <code>
```

In GitHub Actions, set `npm_tag=backport` and `allow_non_latest=true`. Leave `allow_non_latest=false` for normal same-version `latest` releases. Record the exact staggered backport package/version set in `CHANGELOG.md`.

## Code Style

- No build step for source -- packages ship raw ES modules from `src/`
- Event handlers in source and docs use React-style casing: `onClick`, `onInput`. The runtime still accepts lowercase aliases for compatibility.
- Signals use `sig()` to read and `sig.set(value)` / `sig.set(prev => next)` to write. Callable setters remain compatibility-only.
- JSX signal reads in attributes and children are compiler-wrapped automatically; use explicit `() => ...` only when writing hyperscript or intentionally passing a reactive function child.

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

Error codes follow the pattern `WF-XXXX` where XXXX is a four-digit number.

When adding a new error code:

1. Choose the next available number in the appropriate category:
   - `WF-01XX`: Signal errors
   - `WF-02XX`: Effect errors
   - `WF-03XX`: Component errors
   - `WF-04XX`: Rendering errors
   - `WF-05XX`: Store errors
   - `WF-06XX`: Router errors
   - `WF-07XX`: Form errors
   - `WF-08XX`: SSR/hydration errors

2. Include in the error object:
   - `code`: The error code string
   - `message`: Human-readable description
   - `fix`: Suggested fix
   - `signalId` / `effectId` / `componentId`: When applicable

3. Document the error in the error code reference table (in `Agents.md`)

---

## Adding Guardrails

Guardrails are dev-mode checks that catch common mistakes. They run only when `process.env.NODE_ENV !== 'production'`.

Guardrail categories:
- **Signal misuse**: Reading without `()`, mutating in place
- **Missing reactive wrapper**: Passing signal reference instead of value
- **Stale closure**: Signal read outside reactive context
- **API misuse**: Using removed APIs (`show()`), wrong error accessor pattern

When adding a guardrail:

1. Add the check in the relevant source file (e.g., `reactive.js` for signal checks)
2. Wrap in `if (process.env.NODE_ENV !== 'production') { ... }`
3. Include a clear, actionable error message
4. Add an ESLint rule in `eslint-plugin-what` if it can be caught statically
5. Document in `/docs/GOTCHAS.md`

---

## Reporting Issues

Open an issue at [github.com/CelsianJs/what-framework/issues](https://github.com/CelsianJs/what-framework/issues). Include:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (Node version, OS, browser)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
