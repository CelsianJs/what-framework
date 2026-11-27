// Static export adapter — build-time render of static/hybrid routes to a
// deployable directory of .html files (+ a data.json per page for client-side
// navigation, mirroring Next's _next/data).

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { matchRoute } from 'what-router/match';
import { renderDocument, serializeState } from '../index.js';
import { createResponse } from '../response.js';
import { escapeHtml } from '../html.js';

// What a static host can do with a redirect: a page that sends the browser on
// at once, and tells crawlers where the content lives.
function redirectStub(location) {
  const target = escapeHtml(location);
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + `<meta http-equiv="refresh" content="0; url=${target}">`
    + `<link rel="canonical" href="${target}"><meta name="robots" content="noindex">`
    + `<title>Redirecting</title></head><body><a href="${target}">${target}</a></body></html>`;
}

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
 * Each page's loader and components get a `request` (a GET of the page's URL,
 * below `basePath` when the site is served below one) and a `response`
 * (createResponse()), as on a server. A page that redirects is written as a redirect stub (a meta
 * refresh to the target, with a canonical link) and listed in `redirects`. A
 * page that sets any other status but 200 cannot be served with that status by
 * a static host, so it is not written at all: it is listed in `skipped`, with
 * a warning.
 *
 * @param {object} [options]
 * @param {any[]} [options.routes]
 * @param {string} [options.outDir]
 * @param {(route: any, documentOptions: any) => any} [options.render]
 * @param {Record<string, any>} [options.documentOptions]
 * @param {string} [options.basePath]
 */
export async function exportStatic({ routes = [], outDir, render, documentOptions = {}, basePath = '' } = {}) {
  const base = basePath.replace(/\/+$/, '');
  const written = [];
  /** @type {Array<{ path: string, location: string, status: number }>} */
  const redirects = [];
  /** @type {Array<{ path: string, status: number }>} */
  const skipped = [];

  for (const route of routes) {
    const mode = (route.page && route.page.mode) || route.mode;
    if (mode !== 'static' && mode !== 'hybrid') continue;

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
      const response = createResponse();
      // A GET of the page's own URL, below the base: a <Router> in the page
      // shows the route this file is served for, as it does for a request on
      // a server.
      const request = new Request(new URL(base + urlPath, 'http://localhost'));
      const reqCtx = { params, query: {}, request, response };
      const pageModule = { default: route.component, loader: route.loader };
      const hasLoader = typeof pageModule.loader === 'function';
      // One snapshot per concrete page, shared with default/custom renderers
      // and client navigation. Custom renderers may prepare the context first.
      if (hasLoader) {
        const loader = pageModule.loader;
        let snapshot;
        pageModule.loader = (context) => snapshot ??= new Promise((resolve) => {
          resolve(loader.call(pageModule, context));
        });
      }

      const html = render
        ? await render(pageModule, reqCtx)
        : await renderDocument(pageModule, reqCtx, documentOptions);

      if (response.location) {
        await mkdir(dirPath, { recursive: true });
        await writeFile(join(dirPath, 'index.html'), redirectStub(response.location));
        redirects.push({ path: urlPath, location: response.location, status: response.status });
        continue;
      }
      if (response.status !== 200) {
        console.warn(`[what-server] exportStatic: ${urlPath} rendered with status ${response.status}, which a static host cannot send; it was not written.`);
        skipped.push({ path: urlPath, status: response.status });
        continue;
      }

      const loaderData = hasLoader ? await pageModule.loader(reqCtx) : undefined;
      await mkdir(dirPath, { recursive: true });
      await writeFile(join(dirPath, 'index.html'), html);

      // data.json for client-side navigation (loader data without a round-trip)
      if (hasLoader) {
        await writeFile(join(dirPath, '__what_data.json'), serializeState({ loaderData }));
      }

      written.push(urlPath);
    }
  }

  return { pages: written, redirects, skipped };
}
