import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

export default defineConfig({
  base: './',
  plugins: [what()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    target: 'es2022',
  },
});
