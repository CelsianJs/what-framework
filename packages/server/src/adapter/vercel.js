// Vercel adapter. The runtime render function is the same Web-Fetch core
// handler (deployable as a Vercel Function). ISR maps to Vercel's native
// s-maxage/stale-while-revalidate headers emitted by the cache engine, so it
// works on Vercel with no extra config. buildVercelOutput writes a Build
// Output API v3 directory (config.json + functions/<name>.func layout).

import { createRequestHandler } from './core.js';

export function createVercelHandler(options = {}) {
  // Vercel Functions accept a Web-Fetch (Request) -> Response handler.
  return createRequestHandler(options);
}

/**
 * Write a Build Output API v3 directory (https://vercel.com/docs/build-output-api/v3):
 *
 *   .vercel/output/
 *     config.json                      { version: 3, routes: [...] }
 *     static/**                        (optional) copied from `staticDir`
 *     functions/<name>.func/
 *       .vc-config.json                { runtime, handler, launcherType }
 *       index.mjs (+ any `files`)      the bundled function entry
 *
 * Options:
 *   - outDir        default '.vercel/output'
 *   - functionName  default 'render'
 *   - runtime       default 'nodejs22.x' (any Vercel Node runtime id)
 *   - files         map of { 'relative/path.mjs': contents } written INTO the
 *                   .func directory. Must include the handler entry (the app's
 *                   build step bundles routes + createVercelHandler into it).
 *   - handler       entry filename inside the .func dir, default 'index.mjs'
 *   - staticDir     (optional) directory copied to static/ — served by Vercel's
 *                   CDN before the function ever runs.
 *
 * Backward compatible: called with no `files`, it writes config.json only and
 * the app's build step is responsible for emitting the functions/ directory.
 *
 * The function entry must export a Web-Fetch handler, e.g.:
 *   // index.mjs (bundled with routes + what-server)
 *   import { createVercelHandler } from 'what-server';
 *   export default createVercelHandler({ routes });
 */
export async function buildVercelOutput({
  outDir = '.vercel/output',
  functionName = 'render',
  runtime = 'nodejs22.x',
  files = null,
  handler = 'index.mjs',
  staticDir = null,
} = {}) {
  const { mkdir, writeFile, cp } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  await mkdir(outDir, { recursive: true });

  const config = {
    version: 3,
    routes: [
      // CDN-served static assets win before the render function runs.
      { handle: 'filesystem' },
      { src: '/.*', dest: `/${functionName}` },
    ],
  };
  await writeFile(join(outDir, 'config.json'), JSON.stringify(config, null, 2));

  if (staticDir) {
    await cp(staticDir, join(outDir, 'static'), { recursive: true });
  }

  let functionDir = null;
  if (files && typeof files === 'object') {
    functionDir = join(outDir, 'functions', `${functionName}.func`);
    await mkdir(functionDir, { recursive: true });
    const vcConfig = {
      runtime,
      handler,
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
    };
    await writeFile(join(functionDir, '.vc-config.json'), JSON.stringify(vcConfig, null, 2));
    for (const [rel, contents] of Object.entries(files)) {
      const dest = join(functionDir, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, contents);
    }
    if (!(handler in files)) {
      // eslint-disable-next-line no-console
      console.warn(`[what-server] buildVercelOutput: files does not include the handler entry "${handler}" — the deploy will 500 until your build emits it.`);
    }
  }

  return { config, outDir, functionDir };
}
