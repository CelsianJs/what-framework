// @thenjs/build — Vite plugin + build pipeline

export { thenVitePlugin } from './vite-plugin.js';
export { build } from './build.js';
export {
  scanPages,
  scanAPI,
  scanRPC,
  scanTasks,
  buildRouteManifestFromScan,
  buildTaskManifestFromScan,
  findClientEntriesFromScan,
} from './scanner.js';

export type { ThenVitePluginOptions } from './vite-plugin.js';
export type {
  BuildOptions,
  BuildResult,
  RouteManifest,
  TaskManifest,
} from './build.js';
export type {
  ScannedPage,
  ScannedAPI,
  ScannedRPC,
  ScannedTask,
} from './scanner.js';
