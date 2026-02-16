# Contributing to ThenJS

Thank you for your interest in contributing to ThenJS!

## Development Setup

```bash
git clone https://github.com/zvndev/thenjs.git
cd thenjs
npm install
npm run build
npm test
```

## Project Structure

This is a monorepo with 8 packages in `packages/`. Each package has its own `tsconfig.json` extending the root `tsconfig.base.json`.

## Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add a changeset: `npx changeset`
4. Ensure `tsc -b` passes with zero errors
5. Ensure `vitest run` passes all tests
6. Open a PR

## Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning. Every user-facing change needs a changeset:

```bash
npx changeset
```

Choose the affected packages, the semver bump type (patch/minor/major), and write a summary.

## Code Style

- TypeScript strict mode
- ESM only (`type: "module"`)
- Web Standard APIs over Node-specific APIs where possible
- No external runtime dependencies unless absolutely necessary

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npx vitest

# Run tests for a specific package
npx vitest packages/server
```

## Building

```bash
# Build all packages
npm run build

# Build with watch
npm run dev
```

## Branch Protection

The `main` branch requires:
- Passing CI (test + type check)
- At least one approval
- Up-to-date branch
