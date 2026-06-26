import { defineConfig } from 'vite';
import { reactCompat } from 'what-react/vite';

// recharts is excluded from the reactCompat alias-prebundle and its CJS-only
// transitive deps are force-included so esbuild can prebundle them for ESM.
export default defineConfig({
  plugins: [reactCompat({ exclude: ['recharts'] })],
  optimizeDeps: {
    include: [
      'eventemitter3',
      'victory-vendor/d3-scale',
      'victory-vendor/d3-shape',
      'decimal.js-light',
    ],
  },
});
