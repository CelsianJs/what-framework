import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { compileJSX } from './compile.js';

// Compiled modules are imported from files, not from `data:` URLs. A stack
// frame names its module by URL, and a `data:` URL is the whole module: one
// frame of an error thrown in a large fixture was a line of over a megabyte
// (the form oracle logs 282 of them), and a GitHub Actions runner takes
// minutes to process each such line, so the test jobs never finished.
let dir = null;
let count = 0;

function moduleUrl(code) {
  if (dir === null) {
    const created = mkdtempSync(join(tmpdir(), 'what-compiled-'));
    dir = created;
    process.on('exit', () => rmSync(created, { recursive: true, force: true }));
  }
  const file = join(dir, `compiled-${++count}.mjs`);
  writeFileSync(file, code);
  return pathToFileURL(file).href;
}

export function loadCompiled(source, options) {
  const code = compileJSX(source, options).replace(
    /(['"])(what-framework(?:\/[\w-]+)?)\1/g,
    (_match, _quote, entry) => JSON.stringify(import.meta.resolve(entry)),
  );
  return import(moduleUrl(code));
}
