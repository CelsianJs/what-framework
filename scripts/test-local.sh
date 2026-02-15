#!/bin/bash

# Test What Framework locally without publishing to npm
# This creates a test project and links the local packages

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
TEST_DIR="${1:-$ROOT_DIR/../what-test-app}"

echo ""
echo "  What Framework - Local Test Setup"
echo "  =================================="
echo ""

# Step 1: Link the framework packages globally
echo "  [1/4] Linking framework packages..."

cd "$ROOT_DIR/packages/core"
npm link 2>/dev/null || true

cd "$ROOT_DIR/packages/router"
npm link 2>/dev/null || true

cd "$ROOT_DIR/packages/server"
npm link 2>/dev/null || true

cd "$ROOT_DIR/packages/cli"
npm link 2>/dev/null || true

echo "        Done."

# Step 2: Create test project
echo "  [2/4] Creating test project at: $TEST_DIR"

if [ -d "$TEST_DIR" ]; then
  echo "        Directory exists. Removing..."
  rm -rf "$TEST_DIR"
fi

# Run create-what directly
cd "$ROOT_DIR/packages/create-what"
node index.js "$(basename "$TEST_DIR")" --dir "$(dirname "$TEST_DIR")"

# If create-what doesn't support --dir, do it manually
if [ ! -d "$TEST_DIR" ]; then
  mkdir -p "$TEST_DIR"
  node index.js temp-what-app
  mv temp-what-app/* "$TEST_DIR/" 2>/dev/null || true
  mv temp-what-app/.* "$TEST_DIR/" 2>/dev/null || true
  rmdir temp-what-app 2>/dev/null || true
fi

echo "        Done."

# Step 3: Link local packages in test project
echo "  [3/4] Linking local packages in test project..."

cd "$TEST_DIR"

# Update package.json to use linked packages
cat > package.json << 'EOF'
{
  "name": "what-test-app",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "what dev",
    "build": "what build",
    "preview": "what preview"
  },
  "dependencies": {
    "what-fw": "link:../what-fw/packages/cli"
  }
}
EOF

npm install
npm link what-fw @aspect/core @aspect/router @aspect/server 2>/dev/null || true

echo "        Done."

# Step 4: Done!
echo "  [4/4] Setup complete!"
echo ""
echo "  Next steps:"
echo ""
echo "    cd $TEST_DIR"
echo "    npm run dev"
echo ""
echo "  Then open http://localhost:3000"
echo ""
