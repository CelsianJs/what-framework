// What Framework - Server: the fields of a submitted form as an action
// receives them, one value per name and an array for a repeated name.
//
// Every name is a field of its own: `constructor`, `toString` or `__proto__`
// is a key like any other, never what an object inherits under that name
// (which read as a repeat of a built-in function), and never the prototype.

// The fields the framework reads itself, never handed to an action:
// `what-csrf-token` is an alias for `_csrf` matching the
// <meta name="what-csrf-token"> tag SSR pages embed, so templates can reuse
// one name for both surfaces.
export const RESERVED_FIELDS = new Set(['_action', 'data-action', '_csrf', 'what-csrf-token', '_redirect', '_state', '_actionKey']);

export function addField(fields, key, value) {
  if (!Object.hasOwn(fields, key)) {
    Object.defineProperty(fields, key, { value, writable: true, enumerable: true, configurable: true });
  } else if (Array.isArray(fields[key])) {
    fields[key].push(value);
  } else {
    fields[key] = [fields[key], value];
  }
}
