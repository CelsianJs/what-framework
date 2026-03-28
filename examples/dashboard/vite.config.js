import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
import whatDevTools from 'what-devtools-mcp/vite-plugin';

export default defineConfig({
  plugins: [what(), whatDevTools({ port: 9231 })],
  server: { port: 3457 },
});
