// Static export adapter — build-time render of static/hybrid routes to a
// deployable directory of .html files (+ a data.json per page for client-side
// navigation, mirroring Next's _next/data).

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { matchRoute } from 'what-router/match';
import { renderDocument, serializeState } from '../index.js';

function isDynamic(path) {
  return path.includes(':') || path.includes('*') || path.includes('[');
}

// Build a concrete URL from a route pattern + params (:p, [p], [...p], *p).
function buildConcretePath(pattern, params) {
  return pattern
    .replace(/\[\.\.\.(\w+)\]/g, (_, n) => params[n] ?? '')
    .replace(/\[(\w+)\]/g, (_, n) => params[n] ?? '')
    .replace(/[:*](\w+)/g, (_, n) => params[n] ?? '');
}

// getStaticPaths params come from user data (a CMS slug, a filename), so a value
// like '../../etc/cron.d/x' would escape outDir once join() collapses it. Every
// output directory is checked against the resolved outDir before anything is
// written.
function resolveInsideOutDir(outDir, urlPath) {
  const root = resolve(outDir);
  const dirPath = resolve(join(outDir, urlPath === '/' ? '' : urlPath));
  if (dirPath !== root && !dirPath.startsWith(root + sep)) {
    // ERROR_CODES.STATIC_WRITE_ESCAPE
    throw Object.assign(
      new Error(`[what-server] Refusing to write outside outDir: ${urlPath}`),
      { code: 'ERR_STATIC_WRITE_ESCAPE' },
    );
  }
  return dirPath;
}

/**
 * @param {object} [options]
 * @param {any[]} [options.routes]
 * @param {string} [options.outDir]
 * @param {(route: any, documentOptions: any) => any} [options.render]
 * @param {Record<string, any>} [options.documentOptions]
 */
export async function exportStatic({ routes = [], outDir, render, documentOptions = {} } = {}) {
  const written = [];

  for (const route of routes) {
    const mode = (route.page && route.page.mode) || route.mode;
    if (mode !== 'static' && mode !== 'hybrid') continue;

    const pageModule = { default: route.component, loader: route.loader };

    let concrete = [route.path];
    if (isDynamic(route.path)) {
      if (typeof route.getStaticPaths !== 'function') continue; // can't enumerate
      const result = await route.getStaticPaths();
      concrete = (result.paths || []).map((p) => buildConcretePath(route.path, p.params || {}));
    }

    for (const urlPath of concrete) {
      const dirPath = resolveInsideOutDir(outDir, urlPath);
      const matched = matchRoute(urlPath, [route]);
      const params = matched ? matched.params : {};
      const reqCtx = { params, query: {} };

      const html = render
        ? await render(pageModule, reqCtx)
        : await renderDocument(pageModule, reqCtx, documentOptions);

      await mkdir(dirPath, { recursive: true });
      await writeFile(join(dirPath, 'index.html'), html);

      // data.json for client-side navigation (loader data without a round-trip)
      if (typeof route.loader === 'function') {
        const data = await route.loader(reqCtx);
        await writeFile(join(dirPath, '__what_data.json'), serializeState({ loaderData: data }));
      }

      written.push(urlPath);
    }
  }

  return { pages: written };
}
