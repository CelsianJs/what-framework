/**
 * Benchmark Vite config using the new what-react/vite plugin.
 * This is what users would actually write — one import, one plugin call.
 */
import { defineConfig } from 'vite';
import { reactCompat } from '../packages/react-compat/src/vite-plugin.js';

export default defineConfig({
  root: 'src',
  plugins: [reactCompat()],
  server: {
    port: 4570, // Different port for testing
  },
});
