// Mock Prisma/Neon adapter — simulates Prisma Client over Neon Postgres
// Latency: 40-120ms (network round-trip to serverless Postgres)

let _id = 1;
const store = new Map();

function delay(min = 40, max = 120) {
  const ms = min + Math.random() * (max - min);
  return new Promise(r => setTimeout(r, ms));
}

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

export function createPrismaAdapter(model = 'task') {
  const prefix = `${model}_`;

  return {
    name: 'Prisma/Neon',
    model,

    async findMany({ where, orderBy, include } = {}) {
      await delay();
      let items = [...store.values()].filter(i => i._model === model);
      if (where) {
        if (where.completed !== undefined) items = items.filter(i => i.completed === where.completed);
        if (where.title?.contains) items = items.filter(i => i.title.includes(where.title.contains));
        if (where.categoryId) items = items.filter(i => i.categoryId === where.categoryId);
      }
      if (orderBy) {
        const key = Object.keys(orderBy)[0];
        const dir = orderBy[key] === 'desc' ? -1 : 1;
        items.sort((a, b) => (a[key] > b[key] ? dir : -dir));
      }
      if (include?.category && model === 'task') {
        items = items.map(i => ({
          ...i,
          category: store.get(`category_${i.categoryId}`) || null,
        }));
      }
      return clone(items);
    },

    async findUnique({ where }) {
      await delay(30, 80);
      const item = store.get(`${prefix}${where.id}`);
      return item ? clone(item) : null;
    },

    async create({ data }) {
      await delay(50, 150);
      const id = _id++;
      const now = new Date().toISOString();
      const item = { id, ...data, _model: model, createdAt: now, updatedAt: now };
      store.set(`${prefix}${id}`, item);
      return clone(item);
    },

    async update({ where, data }) {
      await delay(50, 140);
      const key = `${prefix}${where.id}`;
      const existing = store.get(key);
      if (!existing) throw new Error(`${model} not found: ${where.id}`);
      const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
      store.set(key, updated);
      return clone(updated);
    },

    async delete({ where }) {
      await delay(40, 100);
      const key = `${prefix}${where.id}`;
      const existing = store.get(key);
      if (!existing) throw new Error(`${model} not found: ${where.id}`);
      store.delete(key);
      return clone(existing);
    },

    async count({ where } = {}) {
      await delay(20, 60);
      let items = [...store.values()].filter(i => i._model === model);
      if (where?.completed !== undefined) items = items.filter(i => i.completed === where.completed);
      return items.length;
    },

    async $transaction(ops) {
      await delay(80, 200);
      const results = [];
      for (const op of ops) results.push(await op);
      return results;
    },

    _store: store,
    _seed(items) {
      for (const item of items) {
        const id = item.id || _id++;
        store.set(`${prefix}${id}`, { ...item, id, _model: model });
      }
    },
    _clear() {
      for (const [k] of store) { if (k.startsWith(prefix)) store.delete(k); }
    },
  };
}
