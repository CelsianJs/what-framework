import { defineConfig } from 'vite';
import { build } from 'esbuild';
import fs from 'fs';
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

      // Build what-framework as IIFE using esbuild
      const result = await build({
        entryPoints: [path.join(coreRoot, 'index.js')],
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

// Virtual module for the babel plugin source (to register with @babel/standalone)
const babelPluginModule = () => {
  const virtualId = 'virtual:what-babel-plugin';
  const resolvedId = '\0' + virtualId;

  return {
    name: 'what-babel-plugin-source',
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    async load(id) {
      if (id !== resolvedId) return;

      const pluginPath = path.resolve(__dirname, '../../packages/compiler/src/babel-plugin.js');
      let source = fs.readFileSync(pluginPath, 'utf-8');

      // Convert ESM export default to a plain function expression we can re-export
      source = source.replace('export default function whatBabelPlugin(', 'function whatBabelPlugin(');
      // Wrap in a module that exports
      return source + '\nexport default whatBabelPlugin;\n';
    },
  };
};

export default defineConfig({
  plugins: [frameworkBundlePlugin(), babelPluginModule()],
  server: {
    port: 5199,
  },
});
