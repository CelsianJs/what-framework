// Mock Batadata adapter — simulates Batadata's edge-first data path
// Latency: 5-30ms (edge cache hits), 60-150ms (cache miss / write-through)

let _id = 1000;
const collections = new Map();

function delay(min = 5, max = 30) {
  const ms = min + Math.random() * (max - min);
  return new Promise(r => setTimeout(r, ms));
}

function writeDelay() { return delay(60, 150); }

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

function getCollection(name) {
  if (!collections.has(name)) collections.set(name, new Map());
  return collections.get(name);
}

export function createBatadataAdapter(collection = 'tasks') {
  return {
    name: 'Batadata',
    collection,

    // Read — edge-cached, fast
    async query(filter = {}, options = {}) {
      await delay();
      const col = getCollection(collection);
      let items = [...col.values()];
      if (filter.completed !== undefined) items = items.filter(i => i.completed === filter.completed);
      if (filter.title?.$contains) items = items.filter(i => i.title.includes(filter.title.$contains));
      if (filter.categoryId) items = items.filter(i => i.categoryId === filter.categoryId);
      if (options.sort) {
        const [key, dir] = Object.entries(options.sort)[0];
        items.sort((a, b) => (a[key] > b[key] ? (dir === -1 ? -1 : 1) : (dir === -1 ? 1 : -1)));
      }
      if (options.limit) items = items.slice(0, options.limit);
      if (options.expand?.includes('category')) {
        const cats = getCollection('categories');
        items = items.map(i => ({ ...i, category: cats.get(i.categoryId) || null }));
      }
      return clone(items);
    },

    async get(id) {
      await delay(3, 15);
      const item = getCollection(collection).get(id);
      return item ? clone(item) : null;
    },

    // Write — goes through coordination layer, slower
    async insert(data) {
      await writeDelay();
      const col = getCollection(collection);
      const id = String(_id++);
      const now = new Date().toISOString();
      const item = { id, ...data, createdAt: now, updatedAt: now };
      col.set(id, item);
      return clone(item);
    },

    async patch(id, data) {
      await writeDelay();
      const col = getCollection(collection);
      const existing = col.get(id);
      if (!existing) throw new Error(`Not found in ${collection}: ${id}`);
      const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
      col.set(id, updated);
      return clone(updated);
    },

    async remove(id) {
      await writeDelay();
      const col = getCollection(collection);
      const existing = col.get(id);
      if (!existing) throw new Error(`Not found in ${collection}: ${id}`);
      col.delete(id);
      return clone(existing);
    },

    async count(filter = {}) {
      await delay(3, 10);
      const col = getCollection(collection);
      let items = [...col.values()];
      if (filter.completed !== undefined) items = items.filter(i => i.completed === filter.completed);
      return items.length;
    },

    // Batadata supports multi-op atomic writes
    async batch(ops) {
      await writeDelay();
      const results = [];
      const col = getCollection(collection);
      for (const op of ops) {
        if (op.type === 'insert') {
          const id = String(_id++);
          const item = { id, ...op.data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          col.set(id, item);
          results.push(clone(item));
        } else if (op.type === 'patch') {
          const existing = col.get(op.id);
          if (existing) {
            const updated = { ...existing, ...op.data, updatedAt: new Date().toISOString() };
            col.set(op.id, updated);
            results.push(clone(updated));
          }
        } else if (op.type === 'remove') {
          col.delete(op.id);
          results.push({ id: op.id, deleted: true });
        }
      }
      return results;
    },

    _collections: collections,
    _seed(items) {
      const col = getCollection(collection);
      for (const item of items) {
        const id = item.id || String(_id++);
        col.set(id, { ...item, id });
      }
    },
    _clear() { getCollection(collection).clear(); },
  };
}
