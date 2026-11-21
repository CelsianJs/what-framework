import { compileJSX } from './compile.js';

export function loadCompiled(source, options) {
  const code = compileJSX(source, options).replace(
    /(['"])(what-framework(?:\/[\w-]+)?)\1/g,
    (_match, _quote, entry) => JSON.stringify(import.meta.resolve(entry)),
  );
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
