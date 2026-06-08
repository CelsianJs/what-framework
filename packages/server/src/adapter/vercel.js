// Vercel adapter. The runtime render function is the same Web-Fetch core
// handler (deployable as a Vercel Function). ISR maps to Vercel's native
// s-maxage/stale-while-revalidate headers emitted by the cache engine, so it
// works on Vercel with no extra config. buildVercelOutput writes a minimal
// Build Output API config pointing at the function.

import { createRequestHandler } from './core.js';

export function createVercelHandler(options = {}) {
  // Vercel Functions accept a Web-Fetch (Request) -> Response handler.
  return createRequestHandler(options);
}

/**
 * Write a minimal .vercel/output/config.json that routes all requests to a
 * single render function. The function file itself is emitted by the build step
 * (it imports createVercelHandler with the app's routes).
 */
export async function buildVercelOutput({ outDir = '.vercel/output', functionName = 'render' } = {}) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(outDir, { recursive: true });
  const config = {
    version: 3,
    routes: [{ src: '/.*', dest: `/${functionName}` }],
  };
  await writeFile(join(outDir, 'config.json'), JSON.stringify(config, null, 2));
  return { config, outDir };
}
