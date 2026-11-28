import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

// Served below /console/: Vite writes every asset URL there, and the router
// takes its base from it. appType 'custom': server.js renders every page, so
// the plugin compiles the client build for hydration and the --ssr build for
// the server. The file router reads src/pages.
export default defineConfig({
  base: '/console/',
  appType: 'custom',
  plugins: [what()],
  build: {
    outDir: 'dist/client',
    manifest: true,
    rollupOptions: { input: 'src/entry-client.jsx' },
  },
});
