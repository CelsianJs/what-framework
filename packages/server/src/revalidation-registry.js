// Revalidation registry — the indirection that lets app code call
// revalidatePath()/revalidateTag() from `what-framework/server` while the actual
// cache engine lives in the optional `what-isr` package. The deploy adapter
// binds the engine at startup via setRevalidationHandler(); until then these are
// safe no-ops (with a dev hint).
//
// The handler lives on `globalThis`, NOT in a module-level `let`.
//
// This registry is process-wide by definition: one cache engine serves every
// route in the process. A module-level binding only holds that property while
// there is exactly one instance of this module, and a bundler decides that, not
// us. Vura bundles its server entry and each API route separately, so
// `createRequestHandler` bound the entry's copy of the registry while
// `revalidateTag()` inside an API route read a different copy — permanently
// null. The call returned without error, the dev warning was suppressed by
// NODE_ENV=production, and every ISR purge from an API route silently did
// nothing. A page stayed stale until its own revalidate window expired.
//
// A Symbol key keeps it off the global namespace while still being one slot per
// process, which is exactly the scope the thing being stored has.

const KEY = Symbol.for('what.revalidationHandler');

const isDev = typeof process !== 'undefined' ? process.env?.NODE_ENV !== 'production' : true;

/** Bind a cache engine: setRevalidationHandler({ revalidatePath, revalidateTag }). */
export function setRevalidationHandler(handler) {
  globalThis[KEY] = handler;
}

export function getRevalidationHandler() {
  return globalThis[KEY] ?? null;
}

export async function revalidatePath(path, options) {
  const handler = globalThis[KEY];
  if (handler && handler.revalidatePath) return handler.revalidatePath(path, options);
  if (isDev) {
    console.warn(
      `[what] revalidatePath('${path}') had no effect: no cache engine is bound. ` +
      'Create a what-isr engine and bind it in your adapter (setRevalidationHandler).'
    );
  }
}

export async function revalidateTag(tag, options) {
  const handler = globalThis[KEY];
  if (handler && handler.revalidateTag) return handler.revalidateTag(tag, options);
  if (isDev) {
    console.warn(
      `[what] revalidateTag('${tag}') had no effect: no cache engine is bound.`
    );
  }
}
