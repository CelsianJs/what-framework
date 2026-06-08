// In-memory cache store — the zero-config default. LRU eviction + reverse
// indexes (tag -> keys, path -> keys) for O(1) group invalidation.
//
// Insertion order of a Map IS the LRU order: get() re-inserts (moves to newest),
// eviction removes from the front (oldest).

export function createMemoryStore({ maxEntries = 1000 } = {}) {
  const map = new Map();        // key -> entry
  const tagIndex = new Map();   // tag -> Set<key>
  const pathIndex = new Map();  // path -> Set<key>

  function addToIndex(index, name, key) {
    if (name == null) return;
    let set = index.get(name);
    if (!set) index.set(name, (set = new Set()));
    set.add(key);
  }
  function removeFromIndex(index, name, key) {
    if (name == null) return;
    const set = index.get(name);
    if (set) {
      set.delete(key);
      if (set.size === 0) index.delete(name);
    }
  }
  function indexEntry(key, entry) {
    if (entry.tags) for (const t of entry.tags) addToIndex(tagIndex, t, key);
    addToIndex(pathIndex, entry.path, key);
  }
  function deindexEntry(key, entry) {
    if (entry.tags) for (const t of entry.tags) removeFromIndex(tagIndex, t, key);
    removeFromIndex(pathIndex, entry.path, key);
  }
  function removeKey(key) {
    const e = map.get(key);
    if (!e) return false;
    map.delete(key);
    deindexEntry(key, e);
    return true;
  }
  function deleteByIndex(index, name) {
    const set = index.get(name);
    if (!set) return [];
    const deleted = [...set];
    for (const k of deleted) removeKey(k);
    return deleted;
  }

  return {
    async get(key) {
      const e = map.get(key);
      if (!e) return null;
      // LRU touch: move to newest.
      map.delete(key);
      map.set(key, e);
      return e;
    },
    async set(key, entry) {
      if (map.has(key)) deindexEntry(key, map.get(key));
      map.set(key, entry);
      indexEntry(key, entry);
      while (map.size > maxEntries) {
        const oldest = map.keys().next().value;
        removeKey(oldest);
      }
    },
    async delete(key) {
      return removeKey(key);
    },
    async deleteByTag(tag) {
      return deleteByIndex(tagIndex, tag);
    },
    async deleteByPath(path) {
      return deleteByIndex(pathIndex, path);
    },
    async clear() {
      map.clear();
      tagIndex.clear();
      pathIndex.clear();
    },
    async keys() {
      return [...map.keys()];
    },
  };
}
