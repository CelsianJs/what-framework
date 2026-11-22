// what-framework/router re-exports what-router. Its runtime (src/router.js) is
// a pure barrel, so its declarations are one too, and cannot drift from
// what-router's the way a copy would.
export * from 'what-router';
