import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

// appType 'custom': server.js renders every page, so the plugin compiles the
// client build for hydration and the --ssr build for the server.
export default defineConfig({
  appType: 'custom',
  plugins: [what()],
  build: {
    outDir: 'dist/client',
    manifest: true,
    rollupOptions: { input: 'src/entry-client.jsx' },
  },
});
