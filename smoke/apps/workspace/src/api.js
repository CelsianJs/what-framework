// The workspace's backend, in the page: a small project database behind an
// async API with real latency, the shape a fetch client gives an app. A rename
// whose name contains "fail" is refused, which is the app's error path. The
// database is kept in sessionStorage, so it outlives a reload as a server's
// would.

const LATENCY = 120;
const wait = (ms = LATENCY) => new Promise((r) => setTimeout(r, ms));

const OWNERS = ['Ana Ruiz', 'Bo Lindqvist', 'Chidi Obi', 'Dana Park'];
const KINDS = ['launch', 'research', 'migration'];

const DB_KEY = 'atlas:db';
const db = new Map();
const saved = (() => { try { return JSON.parse(sessionStorage.getItem(DB_KEY)); } catch { return null; } })();
const save = () => sessionStorage.setItem(DB_KEY, JSON.stringify([...db.values()]));
if (saved) for (const p of saved) db.set(p.id, p);
else for (let i = 1; i <= 12; i++) {
  db.set(String(i), {
    id: String(i),
    name: `Project ${['Aurora', 'Basalt', 'Cinder', 'Delta', 'Ember', 'Fjord', 'Garnet', 'Harbor', 'Iris', 'Juniper', 'Kestrel', 'Lumen'][i - 1]}`,
    kind: KINDS[i % KINDS.length],
    owner: OWNERS[i % OWNERS.length],
    members: [],
    archived: false,
  });
}

export const calls = { list: 0, detail: 0, rename: 0, create: 0 };
if (typeof window !== 'undefined') window.__api = calls;

export async function listProjects() {
  calls.list++;
  await wait();
  return [...db.values()].filter((p) => !p.archived).map((p) => ({ ...p }));
}

export async function getProject(id) {
  calls.detail++;
  await wait();
  const p = db.get(id);
  if (!p) throw new Error(`No project ${id}`);
  return { ...p };
}

export async function renameProject(id, name) {
  calls.rename++;
  await wait(400);
  if (/fail/i.test(name)) throw new Error(`The server refused the name "${name}"`);
  db.get(id).name = name;
  save();
  return { ...db.get(id) };
}

export async function archiveProject(id) {
  await wait();
  db.get(id).archived = true;
  save();
}

export async function createProject(draft) {
  calls.create++;
  await wait();
  const id = String(db.size + 1);
  db.set(id, { id, name: draft.name, kind: draft.kind, owner: draft.owner, members: draft.members, archived: false });
  save();
  return { ...db.get(id) };
}
