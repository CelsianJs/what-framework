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

- No build step for source — packages ship raw ES modules from `src/`
- Event handlers are lowercase: `onclick`, `oninput` (not camelCase)
- Signals use unified getter/setter: `sig()` reads, `sig(value)` writes
- Reactive children in JSX: `{() => count()}` for text, `{() => items().map(...)}` for lists

## Reporting Issues

Open an issue at [github.com/CelsianJs/what-framework/issues](https://github.com/CelsianJs/what-framework/issues). Include:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your environment (Node version, OS, browser)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
