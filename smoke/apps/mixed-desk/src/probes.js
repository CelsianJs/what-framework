// Counters the smoke check reads (window.__probes): what React components
// rendered, mounted and unmounted, and anything that ran after its component
// was gone. React files count themselves with useProbe (react/probe.js).

export const probes = {
  renders: {},
  mounted: {},
  unmounted: {},
  lateRenders: 0,
  lateCallbacks: 0,
  native: { built: 0, disposed: 0 },
};
window.__probes = probes;

export function count(table, name) {
  probes[table][name] = (probes[table][name] ?? 0) + 1;
}
