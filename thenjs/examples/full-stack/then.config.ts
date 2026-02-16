import { defineConfig } from 'thenjs';

export default defineConfig({
  server: {
    defaultPageMode: 'server',
  },
  rpc: {
    schema: 'zod',
    openapi: {
      title: 'Full-Stack API',
      version: '1.0.0',
    },
  },
});
