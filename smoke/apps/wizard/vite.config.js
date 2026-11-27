import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

import api from './api.js';

// The plugin owns JSX end to end: it sets `jsx: 'preserve'` on the bundler so
// only the What babel plugin touches .jsx, and it excludes what-* from
// dependency pre-bundling. Overriding either splits the runtime into two module
// instances and getCurrentComponent() silently stops resolving.
//
// api() serves Harbor's quote server (api.js) from the dev and preview servers.
export default defineConfig({
  plugins: [what(), api()],
  server: { host: '127.0.0.1', strictPort: true },
  preview: { host: '127.0.0.1', strictPort: true },
});
