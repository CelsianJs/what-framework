import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

// The plugin owns JSX end to end: it sets `jsx: 'preserve'` on the bundler so
// only the What babel plugin touches .jsx, and it excludes what-* from
// dependency pre-bundling. Overriding either splits the runtime into two module
// instances and getCurrentComponent() silently stops resolving.
export default defineConfig({
  plugins: [what()],
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
});
