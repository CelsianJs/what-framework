// what-framework/server re-exports the full server API. Its runtime
// (src/server.js) is a pure barrel, so its declarations are one too: this file
// used to hand-mirror what-server's surface and had drifted 45 exports behind it,
// which is invisible to every TypeScript user and caught by nothing.
export * from 'what-server';
export * from 'what-server/islands';
