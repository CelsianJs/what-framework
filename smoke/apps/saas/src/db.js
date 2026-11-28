// Northstar's database, in the server process: two organisations, their
// projects and issues, 2,000 members each, and their invoices. The JSON API
// (api.js) and the pages' loaders read it; the updateIssue action writes it.
// Every read waits a little, as a real database across a network does.

export const latency = (ms) => new Promise((r) => setTimeout(r, ms));

// A small seeded generator, so every run starts from the same data.
function random(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Ada', 'Bo', 'Chidi', 'Dana', 'Eli', 'Farah', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia', 'Quinn', 'Ravi', 'Sana', 'Tom', 'Uma', 'Vik', 'Wren', 'Yara', 'Zeb'];
const LAST = ['Okafor', 'Lindqvist', 'Park', 'Ruiz', 'Novak', 'Haddad', 'Moreau', 'Tanaka', 'Silva', 'Kowalski', 'Achebe', 'Berg', 'Costa', 'Dubois', 'Eriksen', 'Fischer'];
const ROLES = ['Owner', 'Admin', 'Member', 'Member', 'Member', 'Viewer'];
const TEAMS = ['Platform', 'Growth', 'Payments', 'Mobile', 'Data', 'Support'];
const VERBS = ['Fix', 'Add', 'Remove', 'Speed up', 'Document', 'Refactor', 'Test', 'Migrate'];
const THINGS = ['login redirect', 'billing webhook', 'CSV export', 'search index', 'audit log', 'SSO handshake', 'invoice PDF', 'rate limiter', 'onboarding tour', 'dark mode', 'API tokens', 'usage chart'];
export const STATUSES = ['open', 'in_progress', 'closed'];

const ORGS = new Map([
  ['acme', { id: 'acme', name: 'Acme Robotics', plan: 'Scale', seats: 2000, renews: '2027-03-01' }],
  ['globex', { id: 'globex', name: 'Globex', plan: 'Team', seats: 2000, renews: '2027-01-15' }],
]);

const PROJECTS = new Map([
  ['acme', [
    { id: 'apollo', key: 'APO', name: 'Apollo', lead: 'Dana Park', summary: 'The customer dashboard.' },
    { id: 'borealis', key: 'BOR', name: 'Borealis', lead: 'Chidi Okafor', summary: 'Billing and invoicing.' },
    { id: 'cygnus', key: 'CYG', name: 'Cygnus', lead: 'Hana Tanaka', summary: 'The public API.' },
  ]],
  ['globex', [
    { id: 'delta', key: 'DEL', name: 'Delta', lead: 'Omar Haddad', summary: 'Warehouse robots.' },
    { id: 'ember', key: 'EMB', name: 'Ember', lead: 'Lena Berg', summary: 'Fleet telemetry.' },
  ]],
]);

const ISSUES = new Map();
const MEMBERS = new Map();
const INVOICES = new Map();
const EPOCH = Date.UTC(2026, 10, 1);

for (const [orgId, projects] of PROJECTS) {
  for (const [pi, project] of projects.entries()) {
    const next = random(orgId.length * 1000 + pi);
    const list = [];
    for (let n = 1; n <= 120; n++) {
      list.push({
        id: `${project.key}-${n}`,
        n,
        title: `${VERBS[Math.floor(next() * VERBS.length)]} ${THINGS[Math.floor(next() * THINGS.length)]}`,
        status: STATUSES[n % 7 === 0 ? 2 : n % 3 === 0 ? 1 : next() < 0.25 ? 2 : 0],
        priority: 1 + Math.floor(next() * 4),
        assignee: `${FIRST[Math.floor(next() * FIRST.length)]} ${LAST[Math.floor(next() * LAST.length)]}`,
        updated: EPOCH - Math.floor(next() * 30 * 86400000),
      });
    }
    ISSUES.set(`${orgId}/${project.id}`, list);
  }
  const next = random(orgId.length * 7 + 3);
  const members = [];
  for (let i = 1; i <= 2000; i++) {
    const first = FIRST[Math.floor(next() * FIRST.length)];
    const last = LAST[Math.floor(next() * LAST.length)];
    members.push({
      id: `m${i}`,
      name: `${first} ${last}`,
      email: `${first}.${last}.${i}@${orgId}.example`.toLowerCase(),
      role: ROLES[Math.floor(next() * ROLES.length)],
      team: TEAMS[Math.floor(next() * TEAMS.length)],
      active: EPOCH - Math.floor(next() * 90 * 86400000),
    });
  }
  MEMBERS.set(orgId, members);
  INVOICES.set(orgId, Array.from({ length: 12 }, (_, i) => ({
    id: `INV-${orgId.toUpperCase()}-${2026 * 100 + 12 - i}`,
    month: new Date(Date.UTC(2026, 10 - i, 1)).toISOString().slice(0, 7),
    amount: 1200 + ((i * 37) % 9) * 100,
    status: i === 0 ? 'due' : 'paid',
  })));
}

const PAGE_SIZE = 20;
const SORTS = {
  updated: (a, b) => b.updated - a.updated || a.n - b.n,
  priority: (a, b) => a.priority - b.priority || a.n - b.n,
  title: (a, b) => a.title.localeCompare(b.title) || a.n - b.n,
};

const openCount = (orgId, projectId) => ISSUES.get(`${orgId}/${projectId}`).filter((i) => i.status !== 'closed').length;

export const db = {
  org(orgId) {
    const org = ORGS.get(orgId);
    if (!org) return null;
    const projects = PROJECTS.get(orgId);
    return { ...org, projects: projects.length, open: projects.reduce((n, p) => n + openCount(orgId, p.id), 0), members: MEMBERS.get(orgId).length };
  },
  projects(orgId) {
    return (PROJECTS.get(orgId) ?? []).map((p) => ({ ...p, open: openCount(orgId, p.id) }));
  },
  project(orgId, projectId) {
    const p = (PROJECTS.get(orgId) ?? []).find((x) => x.id === projectId);
    if (!p) return null;
    const issues = ISSUES.get(`${orgId}/${projectId}`);
    const by = Object.fromEntries(STATUSES.map((s) => [s, issues.filter((i) => i.status === s).length]));
    return { ...p, open: openCount(orgId, projectId), byStatus: by, total: issues.length };
  },
  issues(orgId, projectId, { status = 'all', sort = 'updated', page = '1' } = {}) {
    const all = ISSUES.get(`${orgId}/${projectId}`);
    if (!all) return null;
    const rows = all.filter((i) => status === 'all' || i.status === status).sort(SORTS[sort] ?? SORTS.updated);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const at = Math.min(Math.max(1, Number(page) || 1), pages);
    return { rows: rows.slice((at - 1) * PAGE_SIZE, at * PAGE_SIZE).map((i) => ({ ...i })), total: rows.length, page: at, pages };
  },
  issue(orgId, projectId, id) {
    const found = ISSUES.get(`${orgId}/${projectId}`)?.find((i) => i.id === id);
    return found ? { ...found } : null;
  },
  updateIssue(orgId, projectId, id, patch) {
    const issue = ISSUES.get(`${orgId}/${projectId}`)?.find((i) => i.id === id);
    if (!issue) return null;
    if (typeof patch.title === 'string') issue.title = patch.title;
    if (STATUSES.includes(patch.status)) issue.status = patch.status;
    issue.updated = Date.now();
    return { ...issue };
  },
  members(orgId) {
    return MEMBERS.get(orgId) ?? null;
  },
  billing(orgId) {
    const org = ORGS.get(orgId);
    return org ? { plan: org.plan, seats: org.seats, renews: org.renews, invoices: INVOICES.get(orgId) } : null;
  },
};
