# ThenJS + What Framework VS Code Extension

Syntax highlighting and snippets for [ThenJS](https://github.com/zvndev/thenjs) and the What Framework.

## Features

### Syntax Highlighting

- **Event modifiers** -- `on:click|preventDefault` highlighted with distinct scopes for the event name and modifier pipe
- **Binding directives** -- `bind:value` recognized as a binding attribute
- **Client directives** -- `client:load`, `client:idle`, `client:visible` for island hydration strategies
- **Control flow components** -- `<For>`, `<Show>`, `<Switch>`, `<Match>` highlighted as framework components
- **ThenJS APIs** -- `defineConfig()`, `procedure`, `createRouter`, `createRPCClient` highlighted as framework functions
- **Page exports** -- `export const page = { ... }` recognized with constant highlighting

### Snippets

#### What Framework (`what-` prefix)

| Prefix | Description |
|---|---|
| `what-component` | Component scaffold with signal state |
| `what-signal` | Reactive signal declaration |
| `what-effect` | Effect with dependency array |
| `what-for` | `<For>` list rendering |
| `what-show` | `<Show>` conditional rendering |
| `what-switch` | `<Switch>`/`<Match>` multi-branch |
| `what-island` | Island component with client directive |
| `what-derived` | Derived (computed) signal |
| `what-swr` | `useSWR` data fetching |
| `what-on` | Event handler with `on:` syntax |

#### ThenJS (`then-` prefix)

| Prefix | Description |
|---|---|
| `then-config` | `defineConfig` scaffold |
| `then-page` | Page export with rendering mode |
| `then-api` | API route handler (GET/POST/PUT/DELETE) |
| `then-rpc` | RPC procedure with Zod validation |
| `then-router` | RPC router scaffold |
| `then-middleware` | Hook handler / middleware |
| `then-client` | Typed RPC client setup |
| `then-layout` | Page layout component |

### Screenshots

<!-- TODO: Add screenshots -->

## Installation

### From VSIX (local)

1. Build the extension:
   ```bash
   cd vscode-extension
   npx @vscode/vsce package
   ```
2. Install the `.vsix` file:
   - Open VS Code
   - `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and select **Extensions: Install from VSIX...**
   - Select the generated `.vsix` file

### From Source (development)

1. Clone the repository
2. Open the `vscode-extension` folder in VS Code
3. Press `F5` to launch the Extension Development Host

## Supported Languages

- TypeScript (`.ts`)
- TypeScript React / TSX (`.tsx`)
- JavaScript (`.js`)
- JavaScript React / JSX (`.jsx`)

## License

MIT
