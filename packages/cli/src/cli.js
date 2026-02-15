#!/usr/bin/env node

// What Framework - CLI
// Commands: dev, build, preview, generate

import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync, copyFileSync, realpathSync } from 'fs';
import { join, resolve, relative, extname, basename, normalize } from 'path';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { gzipSync } from 'zlib';

// Security: Prevent path traversal attacks
function safePath(base, userPath) {
  try {
    // Reject paths that contain .. segments (path traversal attempt)
    const normalized = normalize(userPath);
    if (normalized.startsWith('..') || normalized.includes('/..') || normalized.includes('\\..')) {
      return null;
    }

    // Get the real base path (resolve symlinks)
    const realBase = realpathSync(base);

    // Resolve the user path against the base
    const resolved = resolve(realBase, normalized);

    // Double-check: ensure resolved path is within base
    if (!resolved.startsWith(realBase + '/') && resolved !== realBase) {
      return null;
    }

    return resolved;
  } catch {
    return null;
  }
}

// Simple WebSocket implementation using native Node.js APIs (no external deps)
class SimpleWebSocketServer {
  constructor({ server }) {
    this.clients = new Set();
    server.on('upgrade', (req, socket, head) => {
      if (req.headers.upgrade?.toLowerCase() !== 'websocket') return;

      const key = req.headers['sec-websocket-key'];
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

const args = process.argv.slice(2);
const command = args[0];

const commands = { dev, build, preview, generate, init };

if (!command || !commands[command]) {
  console.log(`
  what - The closest framework to vanilla JS

  Usage: what <command>

  Commands:
    dev       Start dev server with HMR
    build     Production build
    preview   Preview production build
    generate  Static site generation
    init      Create a new project

  Options:
    --port    Dev server port (default: 3000)
    --host    Dev server host (default: localhost)
  `);
  process.exit(0);
}

commands[command]();

// --- Dev Server ---

async function dev() {
  const port = getFlag('--port', 3000);
  const host = getFlag('--host', 'localhost');
  const config = loadConfig();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);
    let pathname = url.pathname;

    // Handle server actions
    if (pathname === '/__what_action' && req.method === 'POST') {
      const actionId = req.headers['x-what-action'];
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
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
      const modName = pathname.slice(7);
      const modPath = resolveFrameworkModule(modName);
      if (modPath) {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(readFileSync(modPath, 'utf-8'));
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

  server.listen(port, host, () => {
    console.log(`\n  what dev server\n`);
    console.log(`  Local:   http://${host}:${port}`);
    console.log(`  Mode:    ${config.mode || 'hybrid'}`);
    console.log(`  Pages:   ${config.pagesDir || 'src/pages'}`);
    console.log(`  HMR:     WebSocket (instant reload)\n`);
  });

  // Initialize WebSocket server
  const wss = new SimpleWebSocketServer({ server });
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
  const config = loadConfig();
  const outDir = join(cwd, config.outDir || 'dist');
  const useHash = config.hash !== false;
  const hashManifest = {};

  console.log('\n  what build\n');
  if (useHash) console.log('  Hash:    Enabled (cache busting)\n');

  mkdirSync(outDir, { recursive: true });

  // Collect all source files
  const srcDir = join(cwd, 'src');
  const files = collectFiles(srcDir);

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
  bundleRuntime(outDir, useHash, hashManifest);

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

function preview() {
  const config = loadConfig();
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
  const config = loadConfig();
  const outDir = join(cwd, config.outDir || 'dist');

  console.log('\n  what generate (SSG)\n');

  // First do a normal build
  await build();

  // Then pre-render all pages
  const pagesDir = join(cwd, config.pagesDir || 'src/pages');
  if (existsSync(pagesDir)) {
    const pages = collectFiles(pagesDir).filter(f => extname(f) === '.js');
    for (const page of pages) {
      const route = fileToRoute(relative(pagesDir, page));
      console.log(`  Pre-rendering: ${route}`);
      // In full impl: import page, call renderToString, write HTML
    }
  }

  console.log('\n  Static generation complete.\n');
}

// --- Init ---

function init() {
  const name = args[1] || 'my-what-app';
  const dir = join(cwd, name);

  if (existsSync(dir)) {
    console.error(`  Directory "${name}" already exists.`);
    process.exit(1);
  }

  console.log(`\n  Creating ${name}...\n`);

  mkdirSync(join(dir, 'src/pages'), { recursive: true });
  mkdirSync(join(dir, 'src/components'), { recursive: true });
  mkdirSync(join(dir, 'public'), { recursive: true });

  writeFileSync(join(dir, 'what.config.js'), `export default {
  mode: 'hybrid',  // 'static' | 'server' | 'client' | 'hybrid'
};
`);

  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name,
    private: true,
    type: 'module',
    scripts: {
      dev: 'what dev',
      build: 'what build',
      preview: 'what preview',
      generate: 'what generate',
    },
    dependencies: {
      'what-fw': '^0.1.0',
    },
  }, null, 2));

  console.log(`  Done! Next steps:\n`);
  console.log(`  cd ${name}`);
  console.log(`  npm install`);
  console.log(`  npm run dev\n`);
}

// --- Helpers ---

function getFlag(name, defaultValue) {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultValue;
  const val = args[idx + 1];
  return typeof defaultValue === 'number' ? Number(val) : val;
}

function loadConfig() {
  const configPath = join(cwd, 'what.config.js');
  // Simple sync config load (no dynamic import in this context)
  if (existsSync(configPath)) {
    try {
      // Read and extract basic config
      const src = readFileSync(configPath, 'utf-8');
      const match = src.match(/export default\s*(\{[\s\S]*?\})/);
      if (match) {
        return new Function(`return ${match[1]}`)();
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
  return '/' + filepath
    .replace(/\.js$/, '')
    .replace(/\/index$/, '')
    .replace(/\[(\w+)\]/g, ':$1')
    .replace(/\[\.\.\.(\w+)\]/g, '*');
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

function resolveFrameworkModule(name) {
  const whatDir = resolve(__dirname, '../../what/src');
  const coreDir = resolve(__dirname, '../../core/src');
  const routerDir = resolve(__dirname, '../../router/src');
  const serverDir = resolve(__dirname, '../../server/src');

  const map = {
    'core.js': join(whatDir, 'index.js'),
    'reactive.js': join(coreDir, 'reactive.js'),
    'router.js': join(whatDir, 'router.js'),
    'server.js': join(whatDir, 'server.js'),
    'islands.js': join(serverDir, 'islands.js'),
  };

  return map[name] || null;
}

function transformImports(code) {
  // Transform: import { x } from 'what' -> from '/@what/core.js'
  return code
    .replace(/from\s+['"]what['"]/g, "from '/@what/core.js'")
    .replace(/from\s+['"]what\/router['"]/g, "from '/@what/router.js'")
    .replace(/from\s+['"]what\/server['"]/g, "from '/@what/islands.js'");
}

function minifyJS(code) {
  // Lightweight minification: strip comments, collapse whitespace
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')        // block comments
    .replace(/\/\/[^\n]*/g, '')                // line comments
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

function bundleRuntime(outDir, useHash = false, hashManifest = {}) {
  // Copy framework runtime into output for production
  const whatDir = resolve(__dirname, '../../what/src');
  const coreDir = resolve(__dirname, '../../core/src');
  const routerDir = resolve(__dirname, '../../router/src');
  const serverDir = resolve(__dirname, '../../server/src');
  const runtimeDir = join(outDir, '@what');
  mkdirSync(runtimeDir, { recursive: true });

  // Core modules
  const coreModules = [
    'reactive.js', 'h.js', 'dom.js', 'hooks.js',
    'components.js', 'store.js', 'helpers.js', 'scheduler.js',
    'animation.js', 'a11y.js', 'skeleton.js', 'data.js', 'form.js'
  ];

  // Bundle main entry point
  const whatFiles = [
    { src: join(whatDir, 'index.js'), out: 'core.js' },
    { src: join(whatDir, 'router.js'), out: 'router.js' },
    { src: join(whatDir, 'server.js'), out: 'server.js' },
  ];

  for (const { src, out } of whatFiles) {
    if (existsSync(src)) {
      let code = readFileSync(src, 'utf-8');
      code = minifyJS(code);
      let outName = out;

      if (useHash) {
        const hash = contentHash(code);
        const hashedName = addHash(outName, hash);
        hashManifest[`@what/${outName}`] = `@what/${hashedName}`;
        outName = hashedName;
      }

      writeFileSync(join(runtimeDir, outName), code);
      const gzipped = gzipSync(code);
      writeFileSync(join(runtimeDir, outName + '.gz'), gzipped);
    }
  }

  // Bundle core modules
  for (const mod of coreModules) {
    const src = join(coreDir, mod);
    if (existsSync(src)) {
      let code = readFileSync(src, 'utf-8');
      code = minifyJS(code);
      let outName = mod;

      if (useHash) {
        const hash = contentHash(code);
        const hashedName = addHash(outName, hash);
        hashManifest[`@what/${outName}`] = `@what/${hashedName}`;
        outName = hashedName;
      }

      writeFileSync(join(runtimeDir, outName), code);
      const gzipped = gzipSync(code);
      writeFileSync(join(runtimeDir, outName + '.gz'), gzipped);
    }
  }

  // Bundle router
  const routerSrc = join(routerDir, 'index.js');
  if (existsSync(routerSrc)) {
    let code = readFileSync(routerSrc, 'utf-8');
    code = minifyJS(code);
    writeFileSync(join(runtimeDir, 'router-impl.js'), code);
  }

  // Bundle islands
  const islandsSrc = join(serverDir, 'islands.js');
  if (existsSync(islandsSrc)) {
    let code = readFileSync(islandsSrc, 'utf-8');
    code = minifyJS(code);
    writeFileSync(join(runtimeDir, 'islands.js'), code);
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
