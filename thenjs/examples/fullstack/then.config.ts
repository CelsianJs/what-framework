import { defineConfig } from 'thenjs';

export default defineConfig({
  server: {
    port: 3000,
    defaultPageMode: 'hybrid',
  },
  build: {
    adapter: 'auto',
  },
});
