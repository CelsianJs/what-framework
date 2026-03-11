# what-mcp

[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for [What Framework](https://whatfw.com). Gives AI assistants access to What Framework documentation, API references, and code examples.

## Install

```bash
npm install what-mcp
```

## Usage

### With Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "what-framework": {
      "command": "npx",
      "args": ["what-mcp"]
    }
  }
}
```

### Run directly

```bash
npx what-mcp
```

The server communicates over stdio using the MCP protocol.

## Available Tools

| Tool | Description |
|---|---|
| `what_overview` | Framework overview and key features |
| `what_signals` | Signals and reactive primitives (`signal`, `computed`, `effect`, `batch`) |
| `what_components` | Components, `h()` function, and mounting |
| `what_hooks` | React-compatible hooks (`useState`, `useEffect`, `useMemo`, etc.) |
| `what_islands` | Islands architecture and partial hydration |
| `what_routing` | File-based and programmatic routing |
| `what_forms` | Form utilities and validation rules |
| `what_data_fetching` | Data fetching with `useSWR` and `useQuery` |
| `what_animation` | Animation primitives (springs, tweens, gestures) |
| `what_accessibility` | Accessibility utilities (focus traps, ARIA helpers, screen reader) |
| `what_skeleton` | Skeleton loaders and loading states |
| `what_ssr` | Server-side rendering and static generation |
| `what_cli` | CLI commands and configuration |
| `what_search` | Search across all documentation topics |

## Example

When connected, an AI assistant can use these tools to answer questions about What Framework:

- "How do I create a signal?" -> calls `what_signals`
- "Show me how routing works" -> calls `what_routing`
- "How do I set up SSR?" -> calls `what_ssr`
- "Search for useForm" -> calls `what_search` with query "useForm"

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)
- [MCP Specification](https://modelcontextprotocol.io/)

## License

MIT
