// The file tree's state: which folders are open, the filter, the selection.
//
// Each folder's open state is its own signal, so opening one folder re-runs
// that folder's children and nothing else. The filter is one computed over
// all 10,000 entries; while it is set, every folder on a match's path shows
// open, whatever its own state.

import { batch, computed, createSelector, signal } from 'what-framework';

import { makeTree, visibleFor } from './tree.js';

export const nodes = makeTree();

const openState = new Map();
for (const n of nodes) if (n.dir) openState.set(n.id, signal(n.id === 0, `open:${n.name}`));

export const query = signal('', 'query');
export const visible = computed(() => visibleFor(nodes, query()));
export const selected = signal(-1, 'selected');
export const isSelected = createSelector(selected);

export const isOpen = (id) => (visible() ? true : openState.get(id)());
export const toggle = (id) => openState.get(id)((v) => !v);

export function expandAll() {
  batch(() => { for (const s of openState.values()) s(true); });
}

export function collapseAll() {
  batch(() => { for (const [id, s] of openState) s(id === 0); });
}

// What the smoke check reads to prove that collapsing frees what expanding
// built: components created and disposed, effects alive, and how many times a
// row's bindings ran (a binding that outlives its row keeps counting).
export const probes = { created: 0, disposed: 0, effectsLive: 0, bindingRuns: 0, cleanupsLate: 0 };
if (typeof window !== 'undefined') window.__tree = { probes, nodes: nodes.length };
