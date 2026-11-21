// Use the krausest Vite settings for each isolated entry and capture Rollup's module ledger.
import { transformAsync } from '@babel/core';
import { build } from 'vite';
import path from 'node:path';
import what from 'what-compiler/vite';
import solid1 from 'babel-preset-solid';
import solid2 from '@solidjs/babel-plugin';

export const buildSettings = { minify: 'esbuild', target: 'es2022', sourcemap: 'hidden' };

function solidJSX(version) {
  return {
    name: `size:solid${version}-jsx`,
    enforce: 'pre',
    async transform(source, id) {
      if (!id.endsWith('.jsx')) return;
      return transformAsync(source, {
        filename: id,
        babelrc: false,
        configFile: false,
        envName: 'production',
        sourceMaps: true,
        ...(version === 1 ? { presets: [solid1] } : { plugins: [solid2] }),
      });
    },
  };
}

export function whatAliases(core) {
  return [
    { find: 'what-framework/render', replacement: path.join(core, 'render.js') },
    { find: 'what-core/render', replacement: path.join(core, 'render.js') },
    { find: 'what-framework', replacement: path.join(core, 'index.js') },
    { find: 'what-core', replacement: path.join(core, 'index.js') },
  ];
}

export async function buildApp(here, repo, app, framework) {
  const core = path.join(repo, 'packages/core/src');
  const outDir = path.join(here, 'dist', framework, app);
  const aliases = framework === 'what' ? whatAliases(core) : [];
  const plugins = [{
    name: 'size:entry',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [{
        tag: 'script',
        attrs: { type: 'module', src: `/apps/${framework}/${app}.jsx` },
        injectTo: 'body',
      }],
    },
  }];
  if (framework === 'what') plugins.push(what({ production: true }));
  if (framework === 'solid1') {
    aliases.push({ find: 'solid-js', replacement: 'solid1' });
    plugins.push(solidJSX(1));
  }
  if (framework === 'solid2') plugins.push(solidJSX(2));

  const output = await build({
    configFile: false,
    root: here,
    base: './',
    logLevel: 'warn',
    mode: 'production',
    plugins,
    resolve: { alias: aliases },
    esbuild: framework === 'react'
      ? { jsx: 'automatic', jsxImportSource: 'react' }
      : { jsx: 'preserve' },
    build: { ...buildSettings, outDir, emptyOutDir: true },
  });
  return { outDir, chunks: output.output.filter(item => item.type === 'chunk') };
}
