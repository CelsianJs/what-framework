// A deterministic repository of exactly 10,000 entries (folders and files).
//
// Seeded, so every run and the smoke check see the same tree: the check
// imports this module and computes what expand-all, collapse-all and a filter
// must show without reading it back from the page. One branch is a chain of
// folders DEEP_CHAIN levels deep, the shape a vendored dependency tree has,
// so the recursion is deep as well as wide.

export const NODE_COUNT = 10_000;
export const DEEP_CHAIN = 100;

const PACKAGES = ['atlas-core', 'atlas-router', 'atlas-server', 'atlas-cli', 'atlas-ui', 'atlas-data', 'atlas-docs', 'atlas-test'];
const DIRS = ['src', 'lib', 'test', 'bench', 'fixtures', 'types', 'scripts', 'examples'];
const SUBDIRS = ['model', 'view', 'util', 'net', 'store', 'parse', 'render', 'cache', 'auth', 'io'];
const STEMS = ['index', 'router', 'signal', 'effect', 'queue', 'buffer', 'stream', 'token', 'scope', 'graph', 'shape', 'patch'];
const EXTS = ['.js', '.ts', '.json', '.md', '.css'];

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The tree: `{ id, name, dir, depth, parent, children }` for every entry,
 * root first. `nodes[id]` is the entry with that id.
 */
export function makeTree() {
  const rand = mulberry32(20261126);
  const nodes = [];
  const add = (name, dir, parent) => {
    const node = { id: nodes.length, name, dir, depth: parent ? parent.depth + 1 : 0, parent: parent ? parent.id : -1, children: [] };
    nodes.push(node);
    if (parent) parent.children.push(node);
    return node;
  };
  const left = () => NODE_COUNT - nodes.length;

  const root = add('atlas', true, null);

  // The deep chain first, so its size is known: DEEP_CHAIN folders, a file at
  // the bottom.
  let chain = add('node_modules', true, root);
  for (let d = 1; d < DEEP_CHAIN; d++) chain = add(`dep-${d}`, true, chain);
  add('index.js', false, chain);

  // Then packages, folders, subfolders and files until the count is reached.
  outer:
  for (let p = 0; ; p++) {
    const pkg = add(`${PACKAGES[p % PACKAGES.length]}${p >= PACKAGES.length ? `-${Math.floor(p / PACKAGES.length)}` : ''}`, true, root);
    add('package.json', false, pkg);
    for (const dirName of DIRS) {
      if (left() < 3) break outer;
      const dir = add(dirName, true, pkg);
      const subCount = 4 + Math.floor(rand() * 7);
      for (let s = 0; s < subCount; s++) {
        if (left() < 2) break outer;
        const sub = add(SUBDIRS[s % SUBDIRS.length] + (s >= SUBDIRS.length ? s : ''), true, dir);
        const fileCount = 3 + Math.floor(rand() * 12);
        for (let f = 0; f < fileCount; f++) {
          if (left() < 1) break outer;
          add(`${STEMS[Math.floor(rand() * STEMS.length)]}-${f}${EXTS[Math.floor(rand() * EXTS.length)]}`, false, sub);
        }
      }
    }
  }
  // Whatever is left goes into the root as loose files.
  while (left() > 0) add(`README-${left()}.md`, false, root);
  return nodes;
}

/** The ids a filter shows: every entry whose name contains the query, and its ancestors. */
export function visibleFor(nodes, query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const keep = new Set();
  for (const n of nodes) {
    if (!n.name.toLowerCase().includes(q)) continue;
    for (let at = n; at && !keep.has(at.id); at = at.parent >= 0 ? nodes[at.parent] : null) keep.add(at.id);
  }
  return keep;
}

/** The ids on screen: the root's subtree, through open folders, filtered when `visible` is a set. */
export function shownIds(nodes, isOpen, visible) {
  const out = [];
  const walk = (n) => {
    out.push(n.id);
    if (!n.dir || !(visible ? true : isOpen(n.id))) return;
    for (const c of n.children) if (!visible || visible.has(c.id)) walk(c);
  };
  walk(nodes[0]);
  return out;
}
