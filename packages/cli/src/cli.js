#!/usr/bin/env node

// What Framework - CLI
// Commands: dev, build, preview, generate

import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync, copyFileSync, realpathSync } from 'fs';
import { join, resolve, relative, extname, basename, normalize, sep } from 'path';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';

// Security: Prevent path traversal attacks. `userPath` is a URL pathname, so it
// starts with '/', so it must be joined onto the base as a RELATIVE path, otherwise
// resolve() would discard the base entirely.
function safePath(base, userPath) {
  try {
    let decoded;
    try {
      decoded = decodeURIComponent(userPath);
    } catch {
      return null;
    }
    if (decoded.includes('\0')) return null;

    // Reject paths that contain .. segments (path traversal attempt)
    const normalized = normalize(decoded);
    if (normalized.startsWith('..') || normalized.includes('/..') || normalized.includes('\\..')) {
      return null;
    }

    // Never serve dotfiles (.env, .git, ...)
    if (normalized.split(/[\\/]/).some((s) => s.length > 1 && s.startsWith('.'))) {
      return null;
    }

    // Get the real base path (resolve symlinks)
    const realBase = realpathSync(base);

    // Resolve the user path against the base, always relatively
    const rel = normalized.startsWith('/') || normalized.startsWith('\\') ? '.' + normalized : './' + normalized;
    const resolved = resolve(realBase, rel);
    if (!isInside(resolved, realBase)) return null;

    // readFileSync follows symlinks, so the RESOLVED target must be contained too:
    // `public/leak.txt -> ../../.env` passes the textual check but escapes the root.
    const real = realpathSync(resolved);
    if (!isInside(real, realBase)) return null;

    return real;
  } catch {
    return null;
  }
}

function isInside(target, base) {
  return target === base || target.startsWith(base + sep);
}

// WS handshakes are exempt from the same-origin policy, so any page the developer
// browses could otherwise subscribe to the HMR stream (a live feed of edited file
// paths). Non-browser clients send no Origin at all; browsers always do.
function isAllowedOrigin(origin, allowedHosts) {
  if (!origin) return true;
  try {
    const { hostname, port } = new URL(origin);
    return allowedHosts.has(`${hostname}:${port}`);
  } catch {
    return false;
  }
}

// Simple WebSocket implementation using native Node.js APIs (no external deps)
class SimpleWebSocketServer {
  constructor({ server, allowedHosts = new Set() }) {
    this.clients = new Set();
    server.on('upgrade', (req, socket, head) => {
      if (req.headers.upgrade?.toLowerCase() !== 'websocket') return;

      const key = req.headers['sec-websocket-key'];
      if (!key || !isAllowedOrigin(req.headers.origin, allowedHosts)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      const accept = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '', ''
      ].join('\r\n'));

      const client = new SimpleWebSocket(socket);
      this.clients.add(client);
      client.onclose = () => this.clients.delete(client);
      this.onconnection?.(client);
    });
  }
  on(event, handler) {
    if (event === 'connection') this.onconnection = handler;
  }
}

class SimpleWebSocket {
  constructor(socket) {
    this.socket = socket;
    this.socket.on('close', () => this.onclose?.());
    this.socket.on('error', () => this.onclose?.());
    this.socket.on('data', (data) => this._handleData(data));
  }

  _handleData(buffer) {
    // Simple WebSocket frame parsing (text frames only)
    try {
      const firstByte = buffer[0];
      const opcode = firstByte & 0x0f;
      if (opcode === 0x08) { this.socket.end(); return; } // Close frame

      const secondByte = buffer[1];
      let payloadLength = secondByte & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        payloadLength = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        payloadLength = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const masked = (secondByte & 0x80) !== 0;
      let maskKey;
      if (masked) {
        maskKey = buffer.slice(offset, offset + 4);
        offset += 4;
      }

      let payload = buffer.slice(offset, offset + payloadLength);
      if (masked) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 0x01) { // Text frame
        this.onmessage?.({ data: payload.toString('utf8') });
      }
    } catch (e) {}
  }

  send(data) {
    try {
      const payload = Buffer.from(data, 'utf8');
      const length = payload.length;
      let header;

      if (length < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81; // FIN + text opcode
        header[1] = length;
      } else if (length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(length), 2);
      }

      this.socket.write(Buffer.concat([header, payload]));
    } catch (e) {}
  }

  close() {
    try {
      const closeFrame = Buffer.from([0x88, 0x00]);
      this.socket.write(closeFrame);
      this.socket.end();
    } catch (e) {}
  }
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cwd = process.cwd();
const MAX_ACTION_BODY = 1024 * 1024;
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const args = process.argv.slice(2);
const command = args[0];

const commands = { dev, build, preview, generate, start, init };

const help = `
  what - The closest framework to vanilla JS

  Usage: what <command>

  Commands:
    dev       Start dev server with HMR
    build     Production build
    preview   Preview production build
    generate  Static site generation (pre-render src/pages to HTML)
    start     Run the full-stack server (Node adapter + ISR)
    init      Create a new project (same scaffold as npm create what@latest)

  Options:
    --port     Dev server port (default: 3000)
    --host     Dev server host (default: localhost)
    --version  Print the CLI version
  `;

function main() {
  if (command === '--version' || command === '-v') {
    console.log(packageVersion);
    return;
  }
  if (!command || command === '--help' || command === '-h') {
    console.log(help);
    return;
  }
  if (!commands[command]) {
    console.error(`\n  Unknown command: ${command}`);
    console.error(help);
    process.exit(1);
  }
  commands[command]();
}

// Guarded so the module can be imported (by tests) without running a command.
// argv[1] is the bin symlink under node_modules/.bin, hence the realpath compare.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) main();

export { safePath, isAllowedOrigin, transformImports, fileToRoute };

// --- Dev Server ---

async function dev() {
  const port = getFlag('--port', 3000);
  const host = getFlag('--host', 'localhost');
  const config = await loadConfigAsync();
  const runtimeDirs = requireRuntimeDirs('what dev');

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);
    let pathname = url.pathname;

    // Handle server actions
    if (pathname === '/__what_action' && req.method === 'POST') {
      const actionId = req.headers['x-what-action'];
      let body = '';
      let size = 0;
      let tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        size += chunk.length;
        if (size > MAX_ACTION_BODY) {
          tooLarge = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Request body too large' }));
          req.destroy();
          return;
        }
        body += chunk;
      });
      req.on('end', async () => {
        if (tooLarge) return;
        try {
          const { args } = JSON.parse(body);
          // In production, this would call the registered action
          // For dev, we'll return a placeholder response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            _action: actionId,
            _dev: true,
            message: 'Server actions require production build with action registration',
          }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: e.message }));
        }
      });
      return;
    }

    // Serve framework modules
    if (pathname.startsWith('/@what/')) {
      const mod = resolveFrameworkModule(pathname.slice(7), runtimeDirs);
      if (mod) {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(mod);
        return;
      }
    }

    // Serve static files from public/
    const publicDir = join(cwd, 'public');
    const publicPath = existsSync(publicDir) ? safePath(publicDir, pathname) : null;
    if (publicPath && existsSync(publicPath) && statSync(publicPath).isFile()) {
      serveFile(res, publicPath);
      return;
    }

    // Serve source files (JS, CSS) with transforms
    const srcDir = join(cwd, 'src');
    const srcPath = existsSync(srcDir) ? safePath(srcDir, pathname) : null;
    if (srcPath && existsSync(srcPath) && statSync(srcPath).isFile()) {
      const ext = extname(srcPath);
      if (ext === '.js' || ext === '.mjs') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'no-cache',
        });
        let code = readFileSync(srcPath, 'utf-8');
        // Transform bare imports to /@what/ paths
        code = transformImports(code);
        res.end(code);
        return;
      }
      serveFile(res, srcPath);
      return;
    }

    // Try pages directory for route matching
    const page = resolvePageFile(pathname, config);
    if (page) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(await renderDevPage(page, pathname, config));
      return;
    }

    // SPA fallback: serve index.html for all routes
    const indexPath = join(cwd, 'src', 'index.html');
    if (existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      let html = readFileSync(indexPath, 'utf-8');
      html = injectDevClient(html);
      res.end(html);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  // WebSocket server for HMR (zero dependencies)
  const wsClients = new Set();

  // Auto-start MCP bridge if what-devtools-mcp is installed
  let mcpProcess = null;
  const noMcp = args.includes('--no-mcp');
  if (!noMcp) {
    try {
      const { resolve: importResolve } = await import('node:module');
      // Check if the package exists by trying to resolve it
      const mcpBin = join(cwd, 'node_modules', '.bin', 'what-devtools-mcp');
      const { existsSync: mcpExists } = await import('node:fs');
      if (mcpExists(mcpBin)) {
        const { spawn } = await import('node:child_process');
        const mcpPort = getFlag('--mcp-port', 9229);
        mcpProcess = spawn('node', [mcpBin], {
          env: { ...process.env, WHAT_MCP_PORT: String(mcpPort) },
          stdio: 'pipe',
        });
        mcpProcess.on('error', () => {}); // Silently ignore spawn errors
        mcpProcess.on('exit', () => { mcpProcess = null; });
        // Clean up on exit
        process.on('exit', () => mcpProcess?.kill());
        process.on('SIGINT', () => { mcpProcess?.kill(); process.exit(0); });
      }
    } catch {}
  }

  server.listen(port, host, () => {
    console.log(`\n  what dev server\n`);
    console.log(`  Local:   http://${host}:${port}`);
    console.log(`  Mode:    ${config.mode || 'hybrid'}`);
    console.log(`  Pages:   ${config.pagesDir || 'src/pages'}`);
    console.log(`  HMR:     WebSocket (instant reload)`);
    if (mcpProcess) {
      const mcpPort = getFlag('--mcp-port', 9229);
      console.log(`  MCP:     ws://localhost:${mcpPort} (AI debugging enabled)`);
    }
    console.log();
  });

  // Initialize WebSocket server
  const allowedHosts = new Set(
    ['localhost', '127.0.0.1', '::1', host].map((h) => `${h}:${port}`)
  );
  const wss = new SimpleWebSocketServer({ server, allowedHosts });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.onclose = () => wsClients.delete(ws);
  });

  // Watch for file changes with instant WebSocket notification
  if (config.hmr !== false) {
    watchFiles(cwd, (changedFiles) => {
      const message = JSON.stringify({
        type: 'update',
        files: changedFiles,
        timestamp: Date.now(),
      });

      // Notify all connected clients instantly
      for (const client of wsClients) {
        try {
          client.send(message);
        } catch (e) {
          wsClients.delete(client);
        }
      }
    });
  }
}

// --- Build ---

async function build() {
  const config = await loadConfigAsync();
  const outDir = join(cwd, config.outDir || 'dist');
  const useHash = config.hash !== false;
  const hashManifest = {};

  console.log('\n  what build\n');
  if (useHash) console.log('  Hash:    Enabled (cache busting)\n');

  // Collect all source files
  const srcDir = join(cwd, 'src');
  const files = collectFiles(srcDir);

  if (files.length === 0) {
    console.error(`
  what build: no app found in ${cwd}

  Expected a src/ directory containing your entry point (src/main.js and/or
  src/index.html). Scaffold one with \`npm create what@latest\`, or run this
  from your project root.
`);
    process.exit(1);
    return;
  }

  const runtimeDirs = requireRuntimeDirs('what build');
  mkdirSync(outDir, { recursive: true });

  let totalSize = 0;
  let gzipSize = 0;

  for (const file of files) {
    const rel = relative(srcDir, file);
    const ext = extname(file);
    let outPath = join(outDir, rel);

    mkdirSync(join(outDir, relative(srcDir, join(file, '..'))), { recursive: true });

    if (ext === '.js' || ext === '.mjs') {
      let code = readFileSync(file, 'utf-8');
      code = transformImports(code);
      code = minifyJS(code);

      // Add content hash to filename
      if (useHash && !rel.includes('index')) {
        const hash = contentHash(code);
        const hashedName = addHash(rel, hash);
        outPath = join(outDir, hashedName);
        hashManifest[rel] = hashedName;
      }

      writeFileSync(outPath, code);
      totalSize += code.length;

      // Create gzipped version
      const gzipped = gzipSync(code);
      writeFileSync(outPath + '.gz', gzipped);
      gzipSize += gzipped.length;
    } else if (ext === '.html') {
      let html = readFileSync(file, 'utf-8');
      html = minifyHTML(html);

      // Replace references with hashed versions
      if (useHash) {
        for (const [original, hashed] of Object.entries(hashManifest)) {
          html = html.replace(new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), hashed);
        }
      }
      writeFileSync(outPath, html);
      totalSize += html.length;
    } else {
      copyFileSync(file, outPath);
      totalSize += statSync(file).size;
    }
  }

  // Copy public dir
  const publicDir = join(cwd, 'public');
  if (existsSync(publicDir)) {
    const pubFiles = collectFiles(publicDir);
    for (const file of pubFiles) {
      const rel = relative(publicDir, file);
      const outPath = join(outDir, rel);
      mkdirSync(join(outDir, relative(publicDir, join(file, '..'))), { recursive: true });
      copyFileSync(file, outPath);
    }
  }

  // Bundle the framework runtime
  bundleRuntime(outDir, runtimeDirs);

  // A bare specifier left in the output is a module no browser can load, so the
  // build must fail rather than hand back an artifact that 404s on first paint.
  const unresolved = findBareSpecifiers(outDir);
  if (unresolved.length > 0) {
    console.error(`\n  what build: the output contains imports no browser can resolve:\n`);
    for (const { file, spec } of unresolved.slice(0, 10)) {
      console.error(`    ${file}: '${spec}'`);
    }
    if (unresolved.length > 10) console.error(`    ...and ${unresolved.length - 10} more`);
    console.error(`
  Import the framework as 'what-framework' (or 'what-framework/router',
  'what-framework/server') so the build can rewrite it to /@what/*.js.
`);
    process.exit(1);
    return;
  }

  // Write manifest for production use
  if (useHash && Object.keys(hashManifest).length > 0) {
    writeFileSync(
      join(outDir, 'manifest.json'),
      JSON.stringify(hashManifest, null, 2)
    );
  }

  console.log(`  Output:  ${relative(cwd, outDir)}/`);
  console.log(`  Size:    ${formatSize(totalSize)} (${formatSize(gzipSize)} gzip)`);
  console.log(`  Files:   ${files.length}`);
  if (useHash) {
    console.log(`  Hashed:  ${Object.keys(hashManifest).length} files`);
  }
  console.log();
}

// --- Preview ---

async function preview() {
  const config = await loadConfigAsync();
  const outDir = join(cwd, config.outDir || 'dist');
  const port = getFlag('--port', 4000);

  if (!existsSync(outDir)) {
    console.error('  No build found. Run `what build` first.');
    process.exit(1);
  }

  const server = createServer((req, res) => {
    let pathname = new URL(req.url, `http://localhost:${port}`).pathname;
    if (pathname === '/') pathname = '/index.html';

    // Security: Prevent path traversal
    const filePath = safePath(outDir, pathname);
    if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
      serveFile(res, filePath);
    } else {
      // SPA fallback
      const indexPath = join(outDir, 'index.html');
      if (existsSync(indexPath)) {
        serveFile(res, indexPath);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    }
  });

  server.listen(port, () => {
    console.log(`\n  what preview\n`);
    console.log(`  Local: http://localhost:${port}\n`);
  });
}

// --- Static Generation ---

async function generate() {
  const config = await loadConfigAsync();
  const outDir = join(cwd, config.outDir || 'dist');

  console.log('\n  what generate (SSG)\n');

  // First do a normal build
  await build();

  const pagesDir = join(cwd, config.pagesDir || 'src/pages');
  if (!existsSync(pagesDir)) {
    console.error(`
  what generate: no pages directory at ${relative(cwd, pagesDir)}/

  Static generation pre-renders every page module in that directory (each one
  exporting a default component, optionally a loader). Create it, or use
  \`what build\` for a client-rendered app.
`);
    process.exit(1);
    return;
  }

  const { renderPage } = await import(pathToFileURL(join(requireRuntimeDirs('what generate').server, 'index.js')).href);
  const pages = collectFiles(pagesDir).filter(f => extname(f) === '.js');
  let count = 0;

  for (const page of pages) {
    const route = fileToRoute(relative(pagesDir, page));
    if (route.includes(':') || route.includes('*')) {
      console.log(`  Skipped:       ${route} (dynamic route, no params to pre-render)`);
      continue;
    }

    let html;
    try {
      const mod = await import(pathToFileURL(page).href);
      if (typeof (mod.default || mod) !== 'function') {
        throw new Error('no default-exported component');
      }
      const { body, head } = await renderPage(mod, { params: {}, query: {}, path: route });
      html = staticDocument(body, head);
    } catch (e) {
      console.error(`\n  what generate: failed to pre-render ${relative(cwd, page)}\n\n  ${e.message}\n`);
      process.exit(1);
      return;
    }

    const outPath = route === '/' ? join(outDir, 'index.html') : join(outDir, route.slice(1), 'index.html');
    mkdirSync(join(outPath, '..'), { recursive: true });
    writeFileSync(outPath, html);
    console.log(`  Pre-rendered:  ${route} -> ${relative(cwd, outPath)}`);
    count++;
  }

  if (count === 0) {
    console.error(`
  what generate: no static pages found in ${relative(cwd, pagesDir)}/

  Add a page module (e.g. src/pages/index.js exporting a default component).
`);
    process.exit(1);
    return;
  }

  console.log(`\n  Static generation complete (${count} page${count === 1 ? '' : 's'}).\n`);
}

function staticDocument(body, head) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${head || '<title>What App</title>'}
</head>
<body>
<div id="app">${body}</div>
</body>
</html>
`;
}

// --- Start (full-stack server) ---

// Runs the project's full-stack server (Node adapter + origin-first ISR). The
// scaffold's `server.js` wires createServer({routes, cache, scheduler, …}) and
// self-starts when run as the main module, so we delegate to it — keeping the
// server's wiring in the app (where it's editable) rather than hidden in the CLI.
async function start() {
  const config = await loadConfigAsync();
  const adapter = config.adapter || 'node';
  const serverEntry = join(cwd, 'server.js');

  if (!existsSync(serverEntry)) {
    console.error(`
  what start: no server.js found in ${cwd}

  Full-stack apps run from a server.js (Node adapter + ISR engine). Scaffold one
  with \`npm create what@latest -- --fullstack\`, or create server.js wiring
  createServer({ routes, cache }) from 'what-framework/server'.
`);
    process.exit(1);
    return;
  }

  if (adapter !== 'node') {
    console.log(`  Note: what.config.js adapter is "${adapter}"; \`what start\` runs the Node server. Use \`what build\` for ${adapter} output.`);
  }

  console.log(`\n  what start → running server.js (${adapter} adapter)\n`);

  const child = spawn(process.execPath, [serverEntry], { cwd, stdio: 'inherit', env: process.env });
  // Forward termination signals so Ctrl-C / SIGTERM reach the server (scheduler
  // cleanup runs in its SIGTERM handler).
  const forward = (sig) => { try { child.kill(sig); } catch { /* already gone */ } };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  child.on('exit', (code, signal) => {
    if (signal) { process.kill(process.pid, signal); return; }
    process.exit(code == null ? 0 : code);
  });
}

// --- Init ---

// Delegates to create-what (the canonical scaffolder) so `what init my-app`
// produces exactly the same app as `npm create what@latest` — real app files,
// working package.json scripts, both templates. Every flag is forwarded
// (--fullstack, --template=<name>, --yes), and create-what prints next steps
// that work end-to-end (cd / npm install / npm run dev).
function init() {
  const initArgs = args.slice(1);
  // Non-interactive contexts (CI, piped stdin): scaffold with defaults rather
  // than streaming prompt text into logs.
  if (!process.stdin.isTTY && !initArgs.includes('--yes') && !initArgs.includes('-y')) {
    initArgs.push('--yes');
  }

  const entry = resolveCreateWhat();
  const child = entry
    ? spawn(process.execPath, [entry, ...initArgs], { cwd, stdio: 'inherit' })
    : // Not installed anywhere local — fetch the matching release via npm.
      spawn(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['exec', '--yes', `create-what@^${packageVersion}`, '--', ...initArgs],
        { cwd, stdio: 'inherit' }
      );

  child.on('error', (err) => {
    console.error(`\n  what init could not launch the scaffolder: ${err.message}`);
    console.error('  Run it directly instead:  npm create what@latest\n');
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code == null ? 1 : code));
}

// Locate the create-what scaffolder without a network hit:
//   1) monorepo sibling (this repo's dev checkout)
//   2) an installed create-what package (next to the CLI, or in the project)
// Returns null when neither exists — init falls back to `npm exec create-what`.
function resolveCreateWhat() {
  const sibling = resolve(__dirname, '../../create-what/index.js');
  if (existsSync(sibling)) return sibling;
  try {
    return createRequire(import.meta.url).resolve('create-what');
  } catch { /* not installed next to the CLI */ }
  try {
    return createRequire(join(cwd, 'package.json')).resolve('create-what');
  } catch { /* not installed in the project */ }
  return null;
}

// --- Helpers ---

function getFlag(name, defaultValue) {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultValue;
  const val = args[idx + 1];
  return typeof defaultValue === 'number' ? Number(val) : val;
}

// Async config loader — uses dynamic import() instead of unsafe new Function()
var _configCache = null;
async function loadConfigAsync() {
  if (_configCache) return _configCache;
  const configPath = join(cwd, 'what.config.js');
  if (existsSync(configPath)) {
    try {
      // Use file:// URL for cross-platform ESM import compatibility
      const fileUrl = new URL(`file://${configPath}`);
      const mod = await import(fileUrl.href);
      _configCache = mod.default || mod;
      return _configCache;
    } catch (e) { /* use defaults */ }
  }
  _configCache = { mode: 'hybrid', pagesDir: 'src/pages', outDir: 'dist' };
  return _configCache;
}

// Synchronous wrapper for backward compatibility — returns defaults,
// then callers that need the real config should use loadConfigAsync()
function loadConfig() {
  // If we already loaded async, return cached
  if (_configCache) return _configCache;
  // Fallback: try JSON.parse for simple object configs (no code execution)
  const configPath = join(cwd, 'what.config.js');
  if (existsSync(configPath)) {
    try {
      const src = readFileSync(configPath, 'utf-8');
      const match = src.match(/export default\s*(\{[\s\S]*?\})/);
      if (match) {
        // Only parse if the content is valid JSON (safe subset)
        // Convert JS object literal to JSON: add quotes to keys
        const jsonLike = match[1]
          .replace(/\/\/[^\n]*/g, '')           // strip line comments
          .replace(/\/\*[\s\S]*?\*\//g, '')     // strip block comments
          .replace(/,\s*([}\]])/g, '$1')        // strip trailing commas
          .replace(/(['"])?(\w+)(['"])?\s*:/g, '"$2":')  // quote keys
          .replace(/:\s*'([^']*)'/g, ': "$1"'); // single quotes to double
        return JSON.parse(jsonLike);
      }
    } catch (e) { /* use defaults */ }
  }
  return { mode: 'hybrid', pagesDir: 'src/pages', outDir: 'dist' };
}

function collectFiles(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function resolvePageFile(pathname, config) {
  const pagesDir = join(cwd, config.pagesDir || 'src/pages');
  if (!existsSync(pagesDir)) return null;

  // Try exact match
  const exact = join(pagesDir, pathname + '.js');
  if (existsSync(exact)) return exact;

  // Try index
  const index = join(pagesDir, pathname, 'index.js');
  if (existsSync(index)) return index;

  return null;
}

function fileToRoute(filepath) {
  const route = '/' + filepath
    .split(sep).join('/')
    .replace(/\.js$/, '')
    .replace(/\[\.\.\.(\w+)\]/g, '*')
    .replace(/\[(\w+)\]/g, ':$1')
    .replace(/(^|\/)index$/, '');
  return route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route;
}

async function renderDevPage(pagePath, pathname, config) {
  const route = relative(join(cwd, config.pagesDir || 'src/pages'), pagePath);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>What App</title>
</head>
<body>
  <div id="app"></div>
  <script type="module">
    import { mount } from '/@what/core.js';
    const mod = await import('/pages/${route}');
    const Page = mod.default || mod;
    mount(Page(), '#app');
  </script>
</body>
</html>`;
}

function injectDevClient(html) {
  const devScript = `<script type="module">
  // What HMR client - WebSocket with polling fallback
  const wsUrl = 'ws://' + location.host;
  let ws = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 10;

  function connect() {
    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[what] HMR connected');
        reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'update') {
            console.log('[what] Files changed:', data.files.join(', '));
            // Smart reload: check if we can hot-swap or need full reload
            const needsFullReload = data.files.some(f =>
              f.endsWith('.html') || f.includes('/pages/') || f.includes('index.')
            );
            if (needsFullReload) {
              location.reload();
            } else {
              // For CSS and some JS, we could do hot updates
              // For now, reload but this is where HMR logic would go
              location.reload();
            }
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        ws = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws?.close();
      };
    } catch (e) {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer || reconnectAttempts >= maxReconnectAttempts) return;
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 10000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  // Initial connection
  connect();

  // Fallback: if no WebSocket update in 5s, poll
  let lastActivity = Date.now();
  setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      lastActivity = Date.now();
    } else if (Date.now() - lastActivity > 5000) {
      // Polling fallback
      fetch('/__what_hmr?t=' + Date.now()).then(r => r.json()).then(data => {
        if (data.reload) location.reload();
      }).catch(() => {});
    }
  }, 2000);
</script>`;
  return html.replace('</body>', devScript + '\n</body>');
}

// The runtime lives in the installed packages, NOT at a path relative to this
// file: from node_modules/what-framework-cli/src, `../../what/src` points at a
// package name that was never published. Resolve by package name instead, from
// the CLI, from what-framework itself (pnpm-style trees), then from the project.
var _runtimeDirs = null;
function resolveRuntimeDirs() {
  if (_runtimeDirs) return _runtimeDirs;

  const cliRequire = createRequire(import.meta.url);
  const requires = [cliRequire];
  try { requires.push(createRequire(cliRequire.resolve('what-framework'))); } catch { /* not resolvable here */ }
  try { requires.push(createRequire(join(cwd, 'package.json'))); } catch { /* no project package.json */ }

  const dirs = {};
  const missing = [];
  for (const [key, name] of [['core', 'what-core'], ['router', 'what-router'], ['server', 'what-server']]) {
    for (const req of requires) {
      try { dirs[key] = join(req.resolve(name), '..'); break; } catch { /* try the next root */ }
    }
    if (!dirs[key]) missing.push(name);
  }
  if (missing.length > 0) return { missing };

  _runtimeDirs = dirs;
  return dirs;
}

// Same resolution, but a missing runtime is fatal: every command that needs it
// produces a broken artifact or a 404ing dev server without it.
function requireRuntimeDirs(commandName) {
  const dirs = resolveRuntimeDirs();
  if (dirs.missing) {
    console.error(`
  ${commandName}: could not locate the What Framework runtime (${dirs.missing.join(', ')})

  Install the framework alongside the CLI:  npm install what-framework
`);
    process.exit(1);
  }
  return dirs;
}

// Entry modules served/emitted under /@what/. Each package's sources are copied
// into /@what/<pkg>/, so the entries are one-line re-export shims.
const RUNTIME_ENTRIES = {
  'core.js': "export * from './core/index.js';",
  'reactive.js': "export * from './core/reactive.js';",
  'router.js': "export * from './router/index.js';",
  'server.js': "export * from './server/index.js';\nexport * from './server/islands.js';",
  'islands.js': "export * from './server/islands.js';",
  'jsx-runtime.js': "export * from './core/jsx-runtime.js';",
  'jsx-dev-runtime.js': "export * from './core/jsx-dev-runtime.js';",
};

// App-facing specifier -> served URL. 'what' is the pre-0.11 package name, kept
// so older apps keep building.
const IMPORT_MAP = {
  'what-framework': '/@what/core.js',
  'what-framework/router': '/@what/router.js',
  'what-framework/server': '/@what/server.js',
  'what-framework/jsx-runtime': '/@what/jsx-runtime.js',
  'what-framework/jsx-dev-runtime': '/@what/jsx-dev-runtime.js',
  'what-core': '/@what/core.js',
  'what-router': '/@what/router.js',
  'what-server': '/@what/server.js',
  'what-server/islands': '/@what/islands.js',
  'what': '/@what/core.js',
  'what/router': '/@what/router.js',
  'what/server': '/@what/server.js',
};

const SPECIFIER_RE = /(from\s*|import\s*\(\s*)(['"])([^'"]+)\2/g;

function resolveFrameworkModule(name, runtimeDirs) {
  if (RUNTIME_ENTRIES[name]) return RUNTIME_ENTRIES[name];

  const slash = name.indexOf('/');
  if (slash === -1) return null;
  const dir = runtimeDirs[name.slice(0, slash)];
  if (!dir) return null;
  const file = safePath(dir, '/' + name.slice(slash + 1));
  if (!file || !existsSync(file) || extname(file) !== '.js') return null;

  return rewriteRuntimeImports(readFileSync(file, 'utf-8'), name.split('/').length - 1);
}

function transformImports(code) {
  return code.replace(SPECIFIER_RE, (match, prefix, quote, spec) => {
    const mapped = IMPORT_MAP[spec];
    return mapped ? `${prefix}${quote}${mapped}${quote}` : match;
  });
}

// Rewrites the runtime's own cross-package imports ('what-core',
// 'what-server/islands', ...) to relative paths inside /@what/. `depth` is how
// many directories below /@what/ the importing file sits.
function rewriteRuntimeImports(code, depth) {
  const prefix = depth > 0 ? '../'.repeat(depth) : './';
  return code.replace(SPECIFIER_RE, (match, p, quote, spec) => {
    const target = runtimeTarget(spec);
    return target ? `${p}${quote}${prefix}${target}${quote}` : match;
  });
}

function runtimeTarget(spec) {
  if (spec === 'what-framework') return 'core/index.js';
  if (spec.startsWith('what-framework/')) {
    const sub = spec.slice('what-framework/'.length);
    if (sub === 'router' || sub === 'server') return `${sub}/index.js`;
    return `core/${sub}.js`;
  }
  const m = /^what-(core|router|server)(?:\/(.+))?$/.exec(spec);
  return m ? `${m[1]}/${m[2] || 'index'}.js` : null;
}

function findBareSpecifiers(dir) {
  const found = [];
  for (const file of collectFiles(dir)) {
    if (extname(file) !== '.js') continue;
    const code = readFileSync(file, 'utf-8');
    const re = /(?:^|[;{}\n])\s*(?:import|export)\b[^;'"\n]*from\s*(['"])([^'"]+)\1/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const spec = m[2];
      if (/^[./]/.test(spec) || /^(https?:|node:|data:)/.test(spec)) continue;
      found.push({ file: relative(dir, file), spec });
    }
  }
  return found;
}

function minifyJS(code) {
  // Lightweight minification: strip comments, collapse whitespace.
  // Line comments are only stripped at line start, and an inline `//` is usually a
  // URL inside a string ('http://www.w3.org/2000/svg').
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')          // block comments
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')       // line comments
    .replace(/^\s+/gm, '')                     // leading whitespace
    .replace(/\n\s*\n/g, '\n')                 // empty lines
    .trim();
}

function minifyHTML(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')           // comments
    .replace(/\s{2,}/g, ' ')                   // collapse whitespace
    .replace(/>\s+</g, '><')                   // between tags
    .trim();
}

function contentHash(content) {
  return createHash('md5').update(content).digest('hex').slice(0, 8);
}

function addHash(filename, hash) {
  const ext = extname(filename);
  const base = filename.slice(0, -ext.length);
  return `${base}.${hash}${ext}`;
}

// Copies the framework runtime into the output. Runtime files are NOT
// content-hashed: app code imports them by their stable /@what/*.js URL, so a
// hashed name would leave that import pointing at a file that does not exist.
function bundleRuntime(outDir, runtimeDirs) {
  const runtimeDir = join(outDir, '@what');
  mkdirSync(runtimeDir, { recursive: true });

  for (const [pkg, srcDir] of Object.entries(runtimeDirs)) {
    for (const src of collectFiles(srcDir)) {
      if (extname(src) !== '.js') continue;
      const rel = relative(srcDir, src);
      const outPath = join(runtimeDir, pkg, rel);
      mkdirSync(join(outPath, '..'), { recursive: true });

      const depth = rel.split(sep).length;
      const code = minifyJS(rewriteRuntimeImports(readFileSync(src, 'utf-8'), depth));
      writeFileSync(outPath, code);
      writeFileSync(outPath + '.gz', gzipSync(code));
    }
  }

  for (const [name, code] of Object.entries(RUNTIME_ENTRIES)) {
    writeFileSync(join(runtimeDir, name), code + '\n');
    writeFileSync(join(runtimeDir, name + '.gz'), gzipSync(code + '\n'));
  }
}

function serveFile(res, filepath) {
  const ext = extname(filepath);
  const types = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
  };
  res.writeHead(200, {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(readFileSync(filepath));
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' kB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function watchFiles(dir, onChange) {
  // Simple polling watcher with change tracking — no native deps
  const files = new Map();
  let initialized = false;

  function scan() {
    const current = collectFiles(join(dir, 'src'));
    const changedFiles = [];

    for (const f of current) {
      try {
        const mtime = statSync(f).mtimeMs;
        if (files.get(f) !== mtime) {
          if (initialized) {
            changedFiles.push(relative(dir, f));
          }
          files.set(f, mtime);
        }
      } catch (e) {
        // File was deleted during scan
      }
    }

    // Detect deleted files
    for (const [f] of files) {
      if (!current.includes(f)) {
        files.delete(f);
        if (initialized) {
          changedFiles.push(relative(dir, f) + ' (deleted)');
        }
      }
    }

    if (changedFiles.length > 0) {
      onChange(changedFiles);
    }

    initialized = true;
  }

  scan();
  // Poll every 100ms for more responsive HMR
  setInterval(scan, 100);
}
