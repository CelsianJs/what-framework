/**
 * Importing `what-react/claim-islands` installs island hydration without
 * adoption: each React island of a page the server rendered takes the
 * server's region and renders over it in the browser (MIXED.md, Server
 * rendering). what-react's Vite plugin adds the import with
 * `reactCompat({ hydrateIslands: false })`. It exports nothing.
 */
export {};
