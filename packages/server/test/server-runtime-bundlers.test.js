// The request context must survive bundling.
//
// what-framework/server re-exports what-server. what-framework's package.json
// declared "sideEffects": false, and what-server's Node entry installed its
// AsyncLocalStorage provider as an import side effect, so esbuild dropped the
// install from any app that imported the server API through what-framework.
// Every async component then read `undefined` from useLoaderData() after its
// first `await` (R2). Both halves are fixed: what-framework now declares its
// server entry as having side effects, and every render calls
// ensureServerRuntime(), which a bundler cannot drop because it is called.
//
// The app is bundled for real, with every bundler the repo has, and run.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// A throwaway app directory whose node_modules is the repo's, so the bundlers
// resolve what-framework exactly as an installed app would.
const OUT = mkdtempSync(join(tmpdir(), 'what-server-bundle-'));
symlinkSync(join(REPO, 'node_modules'), join(OUT, 'node_modules'), 'dir');
after(() => rmSync(OUT, { recursive: true, force: true }));

const APP = `
import { h, useLoaderData } from 'what-framework';
import { renderToStream } from 'what-framework/server';

async function Slow() {
  await new Promise((resolve) => setTimeout(resolve, 5));
  const data = useLoaderData();
  return h('p', null, 'user=' + (data && data.user));
}

export async function render(user) {
  let html = '';
  for await (const chunk of renderToStream(h('div', null, h(Slow, {})), { loaderData: { user } })) html += chunk;
  return html;
}
`;

writeFileSync(join(OUT, 'app.mjs'), APP);

// The rendered markup, without the hydration data element that follows it.
async function runBundle(file) {
  const mod = await import(pathToFileURL(file).href);
  const pages = await Promise.all([mod.render('alice'), mod.render('bob')]);
  return pages.map((html) => html.replace(/<script type="application\/json" data-what-data>.*<\/script>$/, ''));
}

describe('what-framework/server keeps the request context when bundled (R2)', () => {
  it('esbuild', async () => {
    const { build } = await import('esbuild');
    const result = await build({
      entryPoints: [join(OUT, 'app.mjs')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const file = join(OUT, 'esbuild.mjs');
    writeFileSync(file, result.outputFiles[0].text);
    assert.deepEqual(await runBundle(file), ['<div><p data-hk="0">user=alice</p></div>', '<div><p data-hk="0">user=bob</p></div>']);
  });

  it('vite (rolldown) SSR build', async () => {
    const { build } = await import('vite');
    const outDir = join(OUT, 'vite');
    await build({
      root: OUT,
      configFile: false,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      ssr: { noExternal: true },
      build: {
        ssr: join(OUT, 'app.mjs'),
        outDir,
        emptyOutDir: true,
        minify: false,
        rollupOptions: { output: { format: 'es', entryFileNames: 'app.mjs' } },
      },
    });
    assert.deepEqual(await runBundle(join(outDir, 'app.mjs')), ['<div><p data-hk="0">user=alice</p></div>', '<div><p data-hk="0">user=bob</p></div>']);
  });
});
