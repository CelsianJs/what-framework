import { defineConfig } from 'vite';
import { reactCompat } from 'what-react/vite';

// The one-line setup the docs advertise: reactCompat() aliases react /
// react-dom / react/jsx-runtime / use-sync-external-store to what-react and
// excludes React-ecosystem packages from pre-bundling.
export default defineConfig({
  plugins: [reactCompat()],
});
