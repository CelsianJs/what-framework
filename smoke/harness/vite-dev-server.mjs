// An app's own Vite dev server, as `npm run dev` starts it, on the port a
// smoke run gives the app (WHAT_SMOKE_MODE=dev, smoke/README.md).
//
//   node smoke/harness/vite-dev-server.mjs <appDir> <port> [configFile]
//
// The app's installed Vite and its config apply. Only the server's address is
// set here: the port, and the HMR socket on that same port, so a run's
// servers stay in its port range even when a config names an HMR port of its
// own (mixed-desk's does). And the watcher polls: file system events do not
// reach every process (a sandbox, a container), and a check that saves an
// edit waits on the watcher.

import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dir, portArg, configFile] = process.argv.slice(2);
const port = Number(portArg);
if (!dir || !Number.isInteger(port)) {
  console.error('usage: node vite-dev-server.mjs <appDir> <port> [configFile]');
  process.exit(2);
}
// The real path: a root reached through a symlink (macOS's /var is
// /private/var, where the run's temp directories are) puts every module
// outside it, served from /@fs/ URLs instead of /src/.
const root = realpathSync(dir);

const vitePkg = createRequire(join(root, 'package.json')).resolve('vite/package.json');
const { version } = JSON.parse(readFileSync(vitePkg, 'utf8'));
const { createServer } = await import(pathToFileURL(join(dirname(vitePkg), 'dist/node/index.js')).href);

const server = await createServer({
  root,
  ...(configFile ? { configFile: join(root, configFile) } : {}),
  server: { host: '127.0.0.1', port, strictPort: true, hmr: { port }, watch: { usePolling: true, interval: 100 } },
});
await server.listen();
console.log(`vite ${version} dev server at http://127.0.0.1:${port}/`);

const stop = () => server.close().finally(() => process.exit(0));
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
