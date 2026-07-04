// what-compiler/file-router — filesystem route scanning + virtual-module
// codegen used by the Vite plugin (src/file-router.js).

export interface ScannedPage {
  url: string;
  file: string;
  [meta: string]: unknown;
}

export interface ScannedRoutes {
  pages: ScannedPage[];
  layouts: ScannedPage[];
  apiRoutes: ScannedPage[];
}

/** Walk a pages directory and collect pages, layouts and API routes. */
export function scanPages(pagesDir: string): ScannedRoutes;

export interface PageConfig {
  /** Render mode declared via `export const page = { mode }`. */
  mode: string;
  [key: string]: unknown;
}

/** Parse `export const page = { ... }` from a page module's source. */
export function extractPageConfig(source: string): PageConfig;

export interface PageExports {
  hasLoader: boolean;
  hasGetStaticPaths: boolean;
  hasPageConfig: boolean;
}

/** Detect which named exports (loader, getStaticPaths, page) a module declares. */
export function detectPageExports(source: string): PageExports;

/** Generate the `virtual:what-routes` client module source. */
export function generateRoutesModule(pagesDir: string, rootDir: string): string;

/** Generate the server-side routes module source. */
export function generateServerRoutesModule(
  pagesDir: string,
  rootDir: string,
): string;
