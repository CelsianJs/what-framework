// The workspace's starting projects. Shared by the server (its database
// starts from these) and the pages.

const NAMES = ['Aurora', 'Basalt', 'Cinder', 'Delta', 'Ember', 'Fjord', 'Garnet', 'Harbor', 'Iris', 'Juniper', 'Kestrel', 'Lumen'];
const OWNERS = ['Ana Ruiz', 'Bo Lindqvist', 'Chidi Obi', 'Dana Park'];
const KINDS = ['launch', 'research', 'migration'];

export const SEED_PROJECTS = NAMES.map((name, i) => ({
  id: String(i + 1),
  name: `Project ${name}`,
  kind: KINDS[(i + 1) % KINDS.length],
  owner: OWNERS[(i + 1) % OWNERS.length],
  members: [],
}));

export const EMPTY_DRAFT = { name: '', kind: 'launch', owner: '', members: [] };

export const USER_COOKIE = 'atlas-user';
export const DRAFT_COOKIE = 'atlas-draft';

/** The value of one cookie in a Cookie header (or document.cookie). */
export function readCookie(header, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(header || '');
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
}

export function writeCookie(name, value) {
  document.cookie = value === null
    ? `${name}=; Path=/; Max-Age=0; SameSite=Lax`
    : `${name}=${encodeURIComponent(JSON.stringify(value))}; Path=/; SameSite=Lax`;
}
