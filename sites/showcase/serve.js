// Showcase app dev server
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const port = process.env.PORT || 3001;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function resolveFile(pathname) {
  for (const base of [join(__dirname, 'public'), join(__dirname, 'src')]) {
    const full = join(base, pathname);
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  return null;
}

function transformImports(code) {
  return code
    .replace(/from\s+['"]@what\/core['"]/g, `from '/framework/core/src/index.js'`)
    .replace(/from\s+['"]@what\/router['"]/g, `from '/framework/router/src/index.js'`)
    .replace(/from\s+['"]@what\/server['"]/g, `from '/framework/server/src/index.js'`)
    // Internal package aliases used by router/server
    .replace(/from\s+['"]what-core['"]/g, `from '/framework/core/src/index.js'`)
    .replace(/from\s+['"]what-router['"]/g, `from '/framework/router/src/index.js'`);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  let pathname = url.pathname;

  // Serve framework source files
  if (pathname.startsWith('/framework/')) {
    const frameworkPath = join(__dirname, '..', '..', 'packages', pathname.slice(11));
    if (existsSync(frameworkPath) && statSync(frameworkPath).isFile()) {
      let code = readFileSync(frameworkPath, 'utf-8');
      code = transformImports(code);
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' });
      res.end(code);
      return;
    }
  }

  if (pathname === '/') pathname = '/index.html';

  const file = resolveFile(pathname);
  if (file) {
    let content = readFileSync(file);
    const ext = extname(file);
    if (ext === '.js') {
      content = transformImports(content.toString('utf-8'));
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  } else {
    // SPA fallback
    const index = join(__dirname, 'public', 'index.html');
    if (existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(index));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

server.listen(port, () => {
  console.log(`\n  Flux Showcase\n  http://localhost:${port}\n`);
});
