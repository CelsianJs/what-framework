import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
import whatMcp from 'what-devtools-mcp/vite';

export default defineConfig({
  plugins: [what(), whatMcp()],
});
