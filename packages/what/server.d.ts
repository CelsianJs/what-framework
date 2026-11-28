// what-framework/server re-exports the full server API. Its runtime
// (src/server.js) is a pure barrel, so its declarations are one too, and
// cannot fall behind what-server's surface the way a hand-written mirror would.
export * from 'what-server';
export * from 'what-server/islands';

// The island shapes are exported by both entries (the root re-exports them for
// convenience). An explicit re-export outranks the two star exports and resolves
// the ambiguity, which is what TS2308 asks for.
export type { IslandOptions, IslandStore, IslandStatus } from 'what-server/islands';
