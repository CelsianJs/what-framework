import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

// The plugin owns JSX end to end: it sets `jsx: 'preserve'` on the bundler so
// only the What babel plugin touches .jsx, and it excludes what-* from
// dependency pre-bundling. server.js serves the build and the room's stream,
// so there is no dev server here: `npm start` builds, then serves.
export default defineConfig({
  plugins: [what()],
});
