import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { compileJSX } from '../../../../test-utils/compile.js';
import { renderDocument, renderDocumentStream, renderToHydratableString, renderToStream, renderToString } from 'what-framework/server';
import { h } from 'what-framework';

export const fixtureURL = new URL('./storefront-roundtrip.jsx', import.meta.url);
export const stock = 'In stock today';
export const rating = '4.5';
export const delivery = 'Delivery tomorrow';

// The page compiled for one of the targets: 'jsx-runtime' (h() vnodes through
// the automatic runtime), 'ssr' (what-compiler's server target), 'dom' (its
// client target) or 'hydratable' (its client target built for hydration).
export async function storefrontCode(target) {
  const source = await readFile(fixtureURL, 'utf8');
  if (target === 'jsx-runtime') {
    return (await transform(source, {
      loader: 'jsx', format: 'esm', jsx: 'automatic', jsxImportSource: 'what-framework',
    })).code;
  }
  return compileJSX(source, {
    filename: 'storefront-roundtrip.jsx',
    pluginOptions: target === 'hydratable' ? { generate: 'dom', hydratable: true } : { generate: target },
  });
}

// Each load is a module of its own: compiled code registers its delegated
// events once per module, on the document it first renders in.
let loads = 0;
export async function loadStorefront(target) {
  const code = (await storefrontCode(target)).replace(
    /(['"])(what-framework(?:\/[\w-]+)?)\1/g,
    (_match, _quote, entry) => JSON.stringify(import.meta.resolve(entry)),
  ) + `\n// load ${loads++}\n`;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

export const modes = [
  'string', 'hydratable', 'document', 'stream', 'stream noScripts',
  'document stream', 'document stream noScripts',
];

export async function serverPage({ createStorefront, loader }, mode) {
  const streamed = mode.includes('stream');
  const fullDocument = mode.startsWith('document');
  const calls = [];
  const stockGate = Promise.withResolvers();
  const deliveryGate = Promise.withResolvers();
  if (!streamed) {
    stockGate.resolve(stock);
    deliveryGate.resolve(delivery);
  }
  const Page = createStorefront({
    initialCustomer: mode === 'string' || mode === 'hydratable' ? loader().customer : undefined,
    fetchStock: () => { calls.push('stock'); return stockGate.promise; },
    fetchDelivery: () => { calls.push('delivery'); return deliveryGate.promise; },
    // A request made with an aborted signal is not sent, as with fetch.
    fetchRating: (signal) => {
      if (signal.aborted) return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      calls.push('rating');
      return stockGate.promise.then(() => rating);
    },
    saveLike: () => Promise.resolve(),
  });
  if (mode === 'string' || mode === 'hydratable') {
    const render = mode === 'string' ? renderToString : renderToHydratableString;
    return { html: render(h(Page)), calls };
  }
  if (!streamed) return { html: await renderDocument({ default: Page, loader }), calls };

  const errors = [];
  const options = { noScripts: mode.endsWith('noScripts'), onError: error => errors.push(error) };
  const stream = fullDocument
    ? await renderDocumentStream({ default: Page, loader }, {}, options)
    : renderToStream(h(Page), { ...options, loaderData: loader() });
  const chunks = [];
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
      stockGate.resolve(stock);
      // Keep inner content pending until the parent's HTML has been sent.
      if (chunks.length >= 2) deliveryGate.resolve(delivery);
    }
  } finally {
    stockGate.resolve(stock);
    deliveryGate.resolve(delivery);
  }
  if (errors.length) throw new AggregateError(errors);
  return { html: chunks.join(''), chunks, calls };
}

export function asDocument(html, mode) {
  return mode.startsWith('document') ? html : '<!doctype html><html><head></head><body>' + html + '</body></html>';
}
