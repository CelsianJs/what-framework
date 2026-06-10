// Node module-customization hook: alias bare 'react' / 'react-dom' /
// 'use-sync-external-store' imports (from real React libraries under test)
// to what-react's source files. Registered by test files via:
//   import { register } from 'node:module';
//   register('./_helpers/react-alias-loader.mjs', import.meta.url);
const src = new URL('../../src/', import.meta.url);

const map = {
  'react': new URL('index.js', src).href,
  'react/jsx-runtime': new URL('jsx-runtime.js', src).href,
  'react/jsx-dev-runtime': new URL('jsx-dev-runtime.js', src).href,
  'react-dom': new URL('dom.js', src).href,
  'react-dom/client': new URL('dom.js', src).href,
  'use-sync-external-store/with-selector': new URL('use-sync-external-store-with-selector.js', src).href,
  'use-sync-external-store/with-selector.js': new URL('use-sync-external-store-with-selector.js', src).href,
  'use-sync-external-store/shim/with-selector': new URL('use-sync-external-store-with-selector.js', src).href,
  'use-sync-external-store/shim/with-selector.js': new URL('use-sync-external-store-with-selector.js', src).href,
  'use-sync-external-store/shim': new URL('index.js', src).href,
  'use-sync-external-store/shim/index.js': new URL('index.js', src).href,
};

export function resolve(specifier, context, nextResolve) {
  const mapped = map[specifier];
  if (mapped) {
    return { url: mapped, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
