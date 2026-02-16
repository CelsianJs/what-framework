#!/usr/bin/env node
// thenjs — CLI entry point

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', short: 'p', default: '3000' },
    host: { type: 'string', short: 'H', default: 'localhost' },
    open: { type: 'boolean', short: 'o', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  },
});

const command = positionals[0] ?? 'dev';

if (values.help) {
  printHelp();
  process.exit(0);
}

if (values.version) {
  console.log('thenjs v0.1.0');
  process.exit(0);
}

const root = resolve(process.cwd());

switch (command) {
  case 'dev':
    await runDev(root, {
      port: parseInt(values.port!, 10),
      host: values.host!,
      open: values.open!,
    });
    break;

  case 'build':
    await runBuild(root);
    break;

  case 'preview':
    await runPreview(root, {
      port: parseInt(values.port!, 10),
      host: values.host!,
    });
    break;

  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}

// ─── Commands ───

async function runDev(
  root: string,
  options: { port: number; host: string; open: boolean },
) {
  console.log(`
  ╔══════════════════════════════════╗
  ║          T H E N J S            ║
  ║       Meta-Framework for        ║
  ║       What Framework            ║
  ╚══════════════════════════════════╝
  `);

  const { loadConfig } = await import('@thenjs/server');
  const config = await loadConfig(root);

  const port = config.server?.port ?? options.port;
  const host = config.server?.host ?? options.host;

  // Start Vite in middleware mode
  const { createServer: createViteServer } = await import('vite');
  const { thenVitePlugin } = await import('@thenjs/build');

  const vite = await createViteServer({
    root,
    plugins: thenVitePlugin({ config, root }),
    server: {
      port,
      host,
      open: options.open,
    },
    appType: 'custom',
  });

  await vite.listen();

  console.log(`  Dev server running at:`);
  console.log(`  → Local:   http://${host}:${port}`);
  console.log(`  → Network: http://0.0.0.0:${port}`);
  console.log('');
  console.log('  Press Ctrl+C to stop');
}

async function runBuild(root: string) {
  console.log('[thenjs] Starting production build...');

  const { loadConfig } = await import('@thenjs/server');
  const { build } = await import('@thenjs/build');

  const config = await loadConfig(root);

  await build({ config, root });

  console.log('[thenjs] Production build complete!');
}

async function runPreview(
  root: string,
  options: { port: number; host: string },
) {
  const { loadConfig } = await import('@thenjs/server');
  const config = await loadConfig(root);

  const port = config.server?.port ?? options.port;
  const host = config.server?.host ?? options.host;

  const { preview: vitePreview } = await import('vite');

  const previewServer = await vitePreview({
    root,
    preview: {
      port,
      host,
    },
  });

  console.log(`  Preview server running at:`);
  console.log(`  → http://${host}:${port}`);
}

function printHelp() {
  console.log(`
Usage: thenjs [command] [options]

Commands:
  dev       Start development server (default)
  build     Build for production
  preview   Preview production build locally

Options:
  -p, --port <port>   Server port (default: 3000)
  -H, --host <host>   Server host (default: localhost)
  -o, --open          Open in browser
  -h, --help          Show help
  -v, --version       Show version
  `);
}
