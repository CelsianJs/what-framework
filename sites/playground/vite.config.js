import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5177,
    open: false,
  },
  build: {
    outDir: 'dist',
  },
});
