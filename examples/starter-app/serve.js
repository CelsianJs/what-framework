import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const PORT = 3001;
const DIR = new URL('.', import.meta.url).pathname;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Import map for local framework resolution
function transformImports(code) {
  return code
    .replace(/from ['"]what-framework['"]/g, `from '/vendor/what-framework-core.js'`)
    .replace(/from ['"]what-framework\/router['"]/g, `from '/vendor/what-framework-router.js'`)
    // Internal aliases (compatibility)
    .replace(/from ['"]what-core['"]/g, `from '/vendor/what-framework-core.js'`)
    .replace(/from ['"]what-router['"]/g, `from '/vendor/what-framework-router.js'`);
}

const server = createServer(async (req, res) => {
  let url = req.url.split('?')[0];

  // Vendor files — serve from packages
  if (url.startsWith('/vendor/what-framework-core.js')) {
    const code = await readFile(join(DIR, '../../packages/core/src/index.js'), 'utf8');
    res.writeHead(200, { 'content-type': 'application/javascript' });
    return res.end(transformImports(code));
  }
  if (url.startsWith('/vendor/what-framework-router.js')) {
    const code = await readFile(join(DIR, '../../packages/router/src/index.js'), 'utf8');
    res.writeHead(200, { 'content-type': 'application/javascript' });
    return res.end(transformImports(code));
  }

  // Try exact file, then .html, then SPA fallback
  let filePath = join(DIR, 'public', url === '/' ? 'index.html' : url);

  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // SPA fallback
    filePath = join(DIR, 'public', 'index.html');
  }

  try {
    let content = await readFile(filePath);
    const ext = extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';

    // Transform JS imports
    if (ext === '.js') {
      content = transformImports(content.toString());
    }

    res.writeHead(200, { 'content-type': mime });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`What Starter App → http://localhost:${PORT}`);
});
