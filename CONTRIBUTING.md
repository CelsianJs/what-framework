# Contributing to What Framework

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/CelsianJs/what-framework.git
cd whatfw
npm install
npm test  # 257 tests should pass
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

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add tests if you're adding new functionality
4. Run `npm test` to make sure everything passes
5. Open a PR with a clear description of what you changed and why

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
