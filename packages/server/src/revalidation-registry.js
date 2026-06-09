// Revalidation registry — the indirection that lets app code call
// revalidatePath()/revalidateTag() from `what-framework/server` while the actual
// cache engine lives in the optional `what-isr` package. The deploy adapter
// binds the engine at startup via setRevalidationHandler(); until then these are
// safe no-ops (with a dev hint).

let _handler = null;

const isDev = typeof process !== 'undefined' ? process.env?.NODE_ENV !== 'production' : true;

/** Bind a cache engine: setRevalidationHandler({ revalidatePath, revalidateTag }). */
export function setRevalidationHandler(handler) {
  _handler = handler;
}

export function getRevalidationHandler() {
  return _handler;
}

export async function revalidatePath(path, options) {
  if (_handler && _handler.revalidatePath) return _handler.revalidatePath(path, options);
  if (isDev) {
    console.warn(
      `[what] revalidatePath('${path}') had no effect: no cache engine is bound. ` +
      'Create a what-isr engine and bind it in your adapter (setRevalidationHandler).'
    );
  }
}

export async function revalidateTag(tag, options) {
  if (_handler && _handler.revalidateTag) return _handler.revalidateTag(tag, options);
  if (isDev) {
    console.warn(
      `[what] revalidateTag('${tag}') had no effect: no cache engine is bound.`
    );
  }
}
