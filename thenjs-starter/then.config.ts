import { defineConfig } from 'thenjs';

export default defineConfig({
  server: {
    defaultPageMode: 'hybrid',
  },
  build: {
    adapter: 'auto',
  },
});
