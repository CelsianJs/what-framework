// what-framework/router re-exports what-router. Its runtime (src/router.js) is
// a pure barrel, so its declarations are one too: this file used to copy
// what-router's, and the copy had drifted (no `preload`, no `data`), which
// strict consumers of the documented import hit and nothing else caught.
export * from 'what-router';
