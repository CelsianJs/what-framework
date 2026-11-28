// What Framework - hydrating the vnodes compiled JSX never makes, and the
// fields only what builds one can hand the walk
//
// hydrate() adopts a component vnode itself (render.js adoptVNode): the JSX
// handed to it lowers to one. Every other vnode (an h() or JSX-runtime
// element, <Suspense>, <ErrorBoundary>, a <Portal>) is made by a vnode
// producer (h.js), and is adopted by render.js _adoptVNodeKinds (a region's
// keyed vnode rows by _adoptVNodeRows), which render.js reaches through this
// module, as h.js installs the vnode renderer through it (and so does
// render.js's _installVNodeRuntime, what-react's mixed mode's install).
//
// What the user changed in the server's form controls before hydration goes
// to the controls built before the walk reached them (render.js placeBuilt,
// fieldCarry here) once what can build a form field is in the program: a
// compiled module whose JSX can (`_$carryFields()` at module scope,
// installFieldCarry here) or a vnode producer (the vnode renderer installed;
// what-react's islands, whose renderer builds fields too, are in a mixed app,
// whose what-react/mixed.js installs one). A field built by hand
// (document.createElement) in a program with neither keeps what it was built
// with.
//
// Here each is what it names, so a program that hydrates carries the
// adoption of every kind and the carrying. In a client build it compiles for
// hydration, what-compiler's Vite plugin serves a stand-in for this module
// (vite-plugin.js, vnodeAdoptionStandIn) in which installing the vnode
// renderer also installs the adoption and the carrying, and installFieldCarry
// installs the carrying: a program none of whose code makes such a vnode or
// builds a field carries neither, and one that does adopts and carries as it
// does here. That holds for the adoption because adopting one writes its
// props and renders through the vnode renderer, which only a producer
// installs (what-react's elements reach a hydration only in a mixed app,
// whose what-react/mixed.js imports h()).
import { _carryFields } from './render.js';
import { vnodeRenderer } from './vnode-renderer.js';
export { _adoptVNodeKinds as adoptVNodeKinds, _adoptVNodeRows as adoptVNodeRows } from './render.js';
export { _installVNodeRuntime as installVNodeRuntime } from './vnode-renderer.js';

let carries = false;

/** A compiled module whose JSX can build a form field was loaded. */
export function installFieldCarry() {
  carries = true;
}

/** What the user changed in `server`'s controls goes to `built`'s, once what can build a field is in the program. */
export function fieldCarry(server, built) {
  if (carries || vnodeRenderer !== null) _carryFields(server, built);
}
