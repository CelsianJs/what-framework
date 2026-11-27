// Showcase app dev server
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, sep } from 'path';
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

// The framework is served from the workspace source. A bare specifier
// (`what-framework/router`) or a package import (`#env`) is resolved the way
// Node and Vite resolve it, through the package's `exports` or `imports` map
// with the `development` condition, and rewritten to a /framework/ URL.
const packagesDir = join(__dirname, '..', '..', 'packages');
const PACKAGES = { 'what-framework': 'what', 'what-core': 'core', 'what-router': 'router', 'what-server': 'server' };
const manifests = new Map();

function manifest(dir) {
  if (!manifests.has(dir)) manifests.set(dir, JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf-8')));
  return manifests.get(dir);
}

function target(entry) {
  if (typeof entry === 'string') return entry;
  return entry && target(entry.development ?? entry.import ?? entry.default);
}

function resolveSpecifier(specifier, fromDir) {
  if (specifier.startsWith('#')) {
    const file = fromDir && target(manifest(fromDir).imports?.[specifier]);
    return file && `/framework/${fromDir}/${file.slice(2)}`;
  }
  const [, name, subpath] = specifier.match(/^(what-[a-z]+)(\/.*)?$/) ?? [];
  const dir = PACKAGES[name];
  const file = dir && target(manifest(dir).exports?.['.' + (subpath ?? '')]);
  return file && `/framework/${dir}/${file.slice(2)}`;
}

function transformImports(code, fromDir) {
  return code.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"./][^'"]*)\2/g,
    (whole, keyword, quote, specifier) => {
      const url = resolveSpecifier(specifier, fromDir);
      return url ? keyword + quote + url + quote : whole;
    });
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  let pathname = url.pathname;

  // Serve framework source files
  if (pathname.startsWith('/framework/')) {
    const frameworkPath = join(packagesDir, pathname.slice(11));
    if (frameworkPath.startsWith(packagesDir + sep) && existsSync(frameworkPath) && statSync(frameworkPath).isFile()) {
      const code = transformImports(readFileSync(frameworkPath, 'utf-8'), pathname.split('/')[2]);
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
  console.log(`\n  What Showcase\n  http://localhost:${port}\n`);
});
