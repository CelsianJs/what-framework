import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

// The plugin owns JSX end to end: it sets `jsx: 'preserve'` on the bundler so
// only the What babel plugin touches .jsx, and it excludes what-* from
// dependency pre-bundling. Overriding either splits the runtime into two module
// instances and getCurrentComponent() silently stops resolving.
//
// The manifest maps each chapter's source file to the chunk it was built
// into, which is how the smoke check knows which request is which chapter.
export default defineConfig({
  plugins: [what()],
  build: { manifest: true },
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
});
