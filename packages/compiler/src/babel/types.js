// The Babel `types` API every module of the plugin builds AST with. Babel hands
// it to the plugin factory (`{ types }`) rather than letting it be imported, so
// the factory installs it here once and the modules read the live binding.

/** @type {any} */
export let t = null;

export function setTypes(types) {
  t = types;
}
