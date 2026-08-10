// Build-time static export: `npm run export`.
//
// exportStatic walks the route table, renders every static and hybrid route to
// dist/<path>/index.html, and writes a __what_data.json beside each one so a
// client-side navigation can pick up loader data without a round trip. Dynamic
// routes are enumerated through getStaticPaths.
//
// This is the only thing in the app that proves "prerendered at build time"
// rather than "rendered on first request and then cached", which is a different
// claim with a different failure mode.

import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { exportStatic } from 'what-framework/server';
import { routes } from './src/routes.js';
import { documentOptions } from './server.js';

const outDir = fileURLToPath(new URL('dist', import.meta.url));

await rm(outDir, { recursive: true, force: true });

// documentOptions.head is a getter (it re-reads the devtools token per render),
// so spread it into a plain object once here rather than passing the live one.
const { pages } = await exportStatic({
  routes,
  outDir,
  documentOptions: { ...documentOptions, head: documentOptions.head },
});

console.log(`[storefront] exported ${pages.length} page(s) to dist/`);
for (const page of pages) console.log(`  ${page}`);
