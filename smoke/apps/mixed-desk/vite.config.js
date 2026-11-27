import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
import { reactCompat } from 'what-react/vite';

// Mixed mode: every file is native What unless it imports react (or calls a
// React package's hook), and a React package's component used in a native
// file is a React island. The client-only desk is built to dist/; the
// server-rendered quote page has its own config (vite.ssr.config.js).
export default defineConfig({
  plugins: [what(), reactCompat()],
  server: { host: '127.0.0.1', strictPort: true, hmr: { port: 5659 } },
  preview: { host: '127.0.0.1', strictPort: true },
});
