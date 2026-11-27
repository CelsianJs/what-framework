// What the wall builds and releases, counted for the smoke check, and the
// handles it reads the animations through.

export const probes = { chartFrames: 0, alertsLive: 0, alertsMade: 0, alertTimers: 0, panelsLive: 0, ringStarts: 0, ringDone: 0 };
export const handles = {};
if (typeof window !== 'undefined') window.__pulse = { probes, handles };
