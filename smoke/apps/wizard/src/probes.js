// What the smoke check reads to prove that removing an item frees what adding
// it built: item components created and disposed (by kind), item effects
// alive, and how often an item's bindings ran (a binding that outlives its
// item keeps counting under it). Steps are counted the same way, and each
// save of the draft.

export const probes = {
  created: { vehicle: 0, driver: 0, incident: 0, step: 0 },
  disposed: { vehicle: 0, driver: 0, incident: 0, step: 0 },
  effectsLive: 0,
  bindingRuns: {},
  saves: 0,
  focusRestored: 0,
};

export function countBinding(id) {
  probes.bindingRuns[id] = (probes.bindingRuns[id] || 0) + 1;
}

if (typeof window !== 'undefined') window.__wizard = { probes };
