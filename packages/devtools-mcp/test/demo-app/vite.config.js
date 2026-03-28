import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  plugins: [{
    name: 'what-jsx',
    transform(code, id) {
      if (!/\.[jt]sx$/.test(id)) return null;
      return { code, map: null }; // Let esbuild handle JSX
    },
  }],
  esbuild: {
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxImportSource: undefined,
  },
  resolve: {
    alias: {
      'what-core': new URL('../../../core/src/index.js', import.meta.url).pathname,
      'what-devtools': new URL('../../../devtools/src/index.js', import.meta.url).pathname,
    },
  },
  define: {
    __BRIDGE_AUTH_TOKEN__: JSON.stringify(process.env.WHAT_MCP_TOKEN || ''),
    __BRIDGE_PORT__: JSON.stringify(parseInt(process.env.WHAT_MCP_PORT || '9229', 10)),
  },
  server: {
    port: 3456,
  },
});
