// What Framework - hydrating the vnodes compiled JSX never makes
//
// hydrate() adopts a component vnode itself (render.js adoptVNode): the JSX
// handed to it lowers to one. Every other vnode (an h() or JSX-runtime
// element, <Suspense>, <ErrorBoundary>, a <Portal>) is made by a vnode
// producer (h.js), and is adopted by render.js _adoptVNodeKinds (a region's
// keyed vnode rows by _adoptVNodeRows), which render.js reaches through this
// module, as h.js installs the vnode renderer through it (and so does
// render.js's _installVNodeRuntime, what-react's mixed mode's install).
//
// Here both are what they name, so a program that hydrates carries the
// adoption of every kind. In a client build it compiles for hydration,
// what-compiler's Vite plugin serves a stand-in for this module (vite-plugin.js,
// vnodeAdoptionStandIn) in which installing the vnode renderer also installs
// the adoption: a program none of whose code makes such a vnode carries
// neither, and one that makes them adopts them as it does here. That holds
// because adopting one writes its props and renders through the vnode
// renderer, which only a producer installs (what-react's elements reach a
// hydration only in a mixed app, whose what-react/mixed.js imports h()).
export { _adoptVNodeKinds as adoptVNodeKinds, _adoptVNodeRows as adoptVNodeRows } from './render.js';
export { _installVNodeRuntime as installVNodeRuntime } from './vnode-renderer.js';
