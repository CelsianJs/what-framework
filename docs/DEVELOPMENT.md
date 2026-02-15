# Development Guide

How to work with What Framework locally.

## Quick Start (Demo)

The fastest way to see the framework in action:

```bash
# From the repo root
npm run demo
```

Open http://localhost:5173 to see the demo app with all features.

## Running in This Repo

The monorepo has a demo app that uses the framework directly:

```
what-fw/
├── packages/
│   ├── core/        # what-core - signals, hooks, components, Island
│   ├── compiler/    # what-compiler - babel/vite plugins (JSX → h() calls)
│   ├── router/      # what-framework/router - client-side routing
│   ├── server/      # what-framework/server - SSR, islands
│   ├── cli/         # what-framework-cli - CLI tools
│   └── create-what/ # create-what - project scaffolding
├── demo/            # Demo app (run with npm run demo)
└── benchmark/       # Performance benchmarks
```

### Available Scripts

```bash
npm run demo     # Start demo app at localhost:3000
npm run test     # Run all tests
npm run bench    # Run benchmarks
npm run build    # Build all packages
```

## Creating a New Project (Local Development)

Since the packages aren't published to npm yet, use local file references:

### Option 1: Use npm link (Recommended)

```bash
# 1. Link the CLI globally
cd packages/cli
npm link

# 2. Create a new project anywhere
cd ~/Desktop
npx create-what my-app

# 3. In the new project, link to local packages
cd my-app
npm link what-fw

# 4. Run the dev server
npm run dev
```

### Option 2: File References

Create a project with direct file references:

```bash
mkdir my-what-app && cd my-what-app

cat > package.json << 'EOF'
{
  "name": "my-what-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node ../what-fw/packages/cli/src/cli.js dev",
    "build": "node ../what-fw/packages/cli/src/cli.js build"
  }
}
EOF

cat > what.config.js << 'EOF'
export default {
  mode: 'hybrid',
  pagesDir: 'src/pages',
  outDir: 'dist',
};
EOF

mkdir -p src/pages

cat > src/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My What App</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
EOF

cat > src/app.js << 'EOF'
import { h, mount, signal } from 'what';

function App() {
  const count = signal(0);

  return h('div', null,
    h('h1', null, 'Hello What!'),
    h('p', null, 'Count: ', () => count()),
    h('button', { onClick: () => count.set(c => c + 1) }, 'Increment'),
  );
}

mount(h(App), '#app');
EOF

# Run it
npm run dev
```

## Publishing to npm

When ready to publish:

```bash
# 1. Update versions in all package.json files
# 2. Build
npm run build

# 3. Publish (requires npm login)
cd packages/core && npm publish --access public
cd ../router && npm publish --access public
cd ../server && npm publish --access public
cd ../cli && npm publish --access public
cd ../create-what && npm publish --access public
```

After publishing, users can:

```bash
npx create-what my-app
cd my-app
npm install
npm run dev
```

## Package Names

| Package | npm Name | Description |
|---------|----------|-------------|
| core | `@aspect/core` | Signals, hooks, VDOM |
| router | `@aspect/router` | Client-side routing |
| server | `@aspect/server` | SSR, islands |
| cli | `what-fw` | CLI (dev, build, etc.) |
| create-what | `create-what` | Project scaffolding |

## Testing

```bash
# Run all tests
npm test

# Run specific test file
node --test packages/core/test/signal.test.js

# Run with verbose output
node --test --test-reporter=spec packages/core/test/*.test.js
```

## Architecture

There is one unified rendering path. Both JSX and hand-written `h()` code go through the same reconciler:

```
JSX source code
         ↓
what-compiler (babel plugin)
         ↓
h() calls (VNodes)
         ↓
what-core DOM reconciler
         ↓
Surgical DOM updates
```

The compiler outputs `h()` calls imported from `what-core`. There is no separate compiler runtime -- everything goes through the VNode reconciler with keyed reconciliation, component effects, and hook support.

The CLI handles:
- Import rewriting (`'what'` → `'/@what/core.js'`)
- Dev server with HMR (WebSocket-based)
- Production builds with minification and content hashing
- Static site generation
