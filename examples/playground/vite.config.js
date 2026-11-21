import { defineConfig } from 'vite';
import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreRoot = path.resolve(__dirname, '../../packages/core/src');

// Virtual module that provides the What Framework runtime as an IIFE string
const frameworkBundlePlugin = () => {
  const virtualId = 'virtual:what-framework-iife';
  const resolvedId = '\0' + virtualId;

  let cachedBundle = null;

  return {
    name: 'what-framework-iife-bundle',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    async load(id) {
      if (id !== resolvedId) return;

      if (cachedBundle) return cachedBundle;

      // Build what-framework as IIFE using esbuild: the root entry as __What,
      // the compiled-JSX runtime (what-framework/render) as __What.render.
      const result = await build({
        stdin: {
          contents: `export * from './index.js';\nexport * as render from './render.js';\n`,
          resolveDir: coreRoot,
        },
        bundle: true,
        format: 'iife',
        globalName: '__What',
        write: false,
        minify: false,
        platform: 'browser',
        define: {
          'process.env.NODE_ENV': '"production"',
        },
      });

      const code = result.outputFiles[0].text;
      cachedBundle = `export default ${JSON.stringify(code)};`;
      return cachedBundle;
    },
  };
};

// The compiler's Babel plugin, registered with @babel/standalone. It is a module
// graph (babel-plugin.js and its babel/*.js modules, which import what-core's
// markup rules), so it is resolved and bundled like any other module rather
// than copied in as one file's source.
const compilerRoot = path.resolve(__dirname, '../../packages/compiler/src');

export default defineConfig({
  plugins: [frameworkBundlePlugin()],
  resolve: {
    alias: { 'virtual:what-babel-plugin': path.join(compilerRoot, 'babel-plugin.js') },
  },
  // The compiler reads NODE_ENV to decide whether to print build warnings.
  define: { 'process.env.NODE_ENV': '"production"' },
  server: {
    port: 5199,
  },
});
