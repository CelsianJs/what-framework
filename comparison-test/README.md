# WhatFW AI Agent Comparison Tests

Proves that open-source models + WhatFW + MCP tools build better apps than premium models + React.

## Quick Start

```bash
# Run a single test
node harness.js --scenario counter --agent whatfw-mcp

# Run with multiple iterations for statistical significance
node harness.js --scenario todo --agent react-baseline --runs 3

# Compare all combinations
./run-all.sh
```

## Test Matrix

| Scenario | Kimi K2 + WhatFW + MCP | Opus + React | Opus + WhatFW + MCP |
|----------|------------------------|--------------|---------------------|
| Counter (easy) | ? | ? | ? |
| Todo (medium) | ? | ? | ? |
| Dashboard (hard) | ? | ? | ? |

## Scoring (max 16)

- **Builds** (0/1): Does `npm run build` succeed?
- **Runs** (0/1): Does the dev server start without errors?
- **Correct** (0-5): Playwright acceptance tests pass
- **Idiomatic** (0-3): Code follows framework patterns
- **Performance** (0-3): Bundle size, render time
- **Error Recovery** (0-3): Agent self-corrects mistakes

## Environment Variables

- `ANTHROPIC_API_KEY` -- For Claude models
- `MOONSHOT_API_KEY` -- For Kimi K2
- `OPENAI_API_KEY` -- For GPT models (optional)
