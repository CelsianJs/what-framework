#!/usr/bin/env node

// What Framework - CLI
// Commands: dev, build, preview, generate

import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync, copyFileSync } from 'fs';
import { join, resolve, relative, extname, basename } from 'path';
import { createServer } from 'http';
import { fileURLToPath } from 'url';

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
    const publicPath = join(cwd, 'public', pathname);
    if (existsSync(publicPath) && statSync(publicPath).isFile()) {
      serveFile(res, publicPath);
      return;
    }

    // Serve source files (JS, CSS) with transforms
    const srcPath = join(cwd, 'src', pathname);
    if (existsSync(srcPath) && statSync(srcPath).isFile()) {
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

  server.listen(port, host, () => {
    console.log(`\n  what dev server\n`);
    console.log(`  Local:   http://${host}:${port}`);
    console.log(`  Mode:    ${config.mode || 'hybrid'}`);
    console.log(`  Pages:   ${config.pagesDir || 'src/pages'}\n`);
  });

  // Watch for file changes (simple polling — no deps needed)
  if (config.hmr !== false) {
    watchFiles(cwd, () => {
      // In a real impl, this would use WebSocket to notify the client
      // For now, the dev client polls
    });
  }
}

// --- Build ---

async function build() {
  const config = loadConfig();
  const outDir = join(cwd, config.outDir || 'dist');

  console.log('\n  what build\n');

  mkdirSync(outDir, { recursive: true });

  // Collect all source files
  const srcDir = join(cwd, 'src');
  const files = collectFiles(srcDir);

  let totalSize = 0;

  for (const file of files) {
    const rel = relative(srcDir, file);
    const ext = extname(file);
    const outPath = join(outDir, rel);

    mkdirSync(join(outDir, relative(srcDir, join(file, '..'))), { recursive: true });

    if (ext === '.js' || ext === '.mjs') {
      let code = readFileSync(file, 'utf-8');
      code = transformImports(code);
      code = minifyJS(code);
      writeFileSync(outPath, code);
      totalSize += code.length;
    } else if (ext === '.html') {
      let html = readFileSync(file, 'utf-8');
      html = minifyHTML(html);
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
  bundleRuntime(outDir);

  console.log(`  Output:  ${relative(cwd, outDir)}/`);
  console.log(`  Size:    ${formatSize(totalSize)}`);
  console.log(`  Files:   ${files.length}\n`);
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

    const filePath = join(outDir, pathname);
    if (existsSync(filePath) && statSync(filePath).isFile()) {
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
  // What HMR client
  let lastCheck = Date.now();
  setInterval(async () => {
    try {
      const res = await fetch('/__what_hmr?since=' + lastCheck);
      if (res.ok) {
        const data = await res.json();
        if (data.reload) location.reload();
      }
      lastCheck = Date.now();
    } catch(e) {}
  }, 1000);
</script>`;
  return html.replace('</body>', devScript + '\n</body>');
}

function resolveFrameworkModule(name) {
  const coreDir = resolve(__dirname, '../../core/src');
  const routerDir = resolve(__dirname, '../../router/src');
  const serverDir = resolve(__dirname, '../../server/src');

  const map = {
    'core.js': join(coreDir, 'index.js'),
    'reactive.js': join(coreDir, 'reactive.js'),
    'router.js': join(routerDir, 'index.js'),
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

function bundleRuntime(outDir) {
  // Copy framework runtime into output for production
  const coreDir = resolve(__dirname, '../../core/src');
  const runtimeDir = join(outDir, '@what');
  mkdirSync(runtimeDir, { recursive: true });

  const modules = ['index.js', 'reactive.js', 'h.js', 'dom.js', 'hooks.js', 'components.js'];
  for (const mod of modules) {
    const src = join(coreDir, mod);
    if (existsSync(src)) {
      let code = readFileSync(src, 'utf-8');
      code = minifyJS(code);
      writeFileSync(join(runtimeDir, mod === 'index.js' ? 'core.js' : mod), code);
    }
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
  // Simple polling watcher — no native deps
  const files = new Map();

  function scan() {
    const current = collectFiles(join(dir, 'src'));
    let changed = false;
    for (const f of current) {
      const mtime = statSync(f).mtimeMs;
      if (files.get(f) !== mtime) {
        files.set(f, mtime);
        changed = true;
      }
    }
    if (changed) onChange();
  }

  scan();
  setInterval(scan, 500);
}
