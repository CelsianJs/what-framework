import { randomTree } from './random-tree.js';

// Reuse the seeded topology with a recording h(). The original grammar
// intentionally emits invalid HTML and server error boundaries, which have no
// DOM round-trip contract. Translate its branches into valid flow containers
// and give the resulting leaves mutable state.
export function interactionScenario(seed) {
  let state = seed;
  const pick = n => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
  const original = randomTree({
    h: (_tag, _props, ...children) => ({ children }),
    ErrorBoundary: 'error', Suspense: 'suspense',
    createContext: () => ({ Provider: 'provider' }),
    useContext: () => null,
  }, seed);
  function extend(value) {
    if (Array.isArray(value)) return value.flatMap(extend);
    if (typeof value === 'function') return extend(value());
    if (value?.children?.length) return [{ kind: 'group', children: extend(value.children) }];
    return [{ kind: ['text', 'list', 'conditional'][pick(3)], label: 'item ' + pick(100) }];
  }
  const initial = { count: 0, open: true, rows: ['A', 'B', 'C'] };
  const structure = [...extend(original.children), { kind: 'list' }, { kind: 'conditional' }];
  const writes = Array.from({ length: 9 }, () => ['count', 'open', 'rows'][pick(3)]);
  return { initial, structure, writes };
}

export function writeState(state, field) {
  if (field === 'count') return { ...state, count: state.count + 1 };
  if (field === 'open') return { ...state, open: !state.open };
  return { ...state, rows: [...state.rows.slice(1), state.rows[0]] };
}

export function interactionPage(core, shape, initial, fetch, fresh = false) {
  const { h, signal, Suspense, createResource } = core;
  const state = signal(initial, 'scenario state');
  function Resource() {
    const [read] = createResource(fetch, fresh ? { initialValue: 'stock' } : {});
    return h('p', null, () => read() || 'waiting');
  }
  function nodes(leaves) {
    return leaves.map(leaf => {
      if (leaf.kind === 'group') return h('section', null, nodes(leaf.children));
      if (leaf.kind === 'list') {
        return h('ul', null, () => state().rows.map(row => h('li', { key: row }, row)));
      }
      if (leaf.kind === 'conditional') return h('div', null, () => state().open && h('em', null, leaf.label ?? 'open'));
      return h('p', null, () => leaf.label + ' / ' + state().count);
    });
  }
  const Page = () => h('main', null, h('output', null, () => state().count), nodes(shape),
    h(Suspense, { fallback: h('p', null, 'waiting') }, h(Resource)));
  return { Page, vnode: h(Page), state };
}
