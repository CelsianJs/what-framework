import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      // React benchmark uses actual React from npm
      // What benchmark imports from local source
    },
  },
  server: {
    port: 4568,
  },
});
