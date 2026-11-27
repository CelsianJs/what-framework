import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
import { reactCompat } from 'what-react/vite';

// The server-rendered quote page. appType 'custom': server.js renders it, so
// the plugins compile the client build for hydration (and add island
// adoption to it) and the --ssr build for the server.
export default defineConfig({
  appType: 'custom',
  plugins: [what(), reactCompat()],
  build: {
    outDir: 'dist/ssr-client',
    manifest: true,
    rollupOptions: { input: 'src/ssr/entry-client.jsx' },
  },
});
