// Sidebar structure and breadcrumb labels, shared by the shell and the
// settings sub-layout. Kept out of routes.jsx so neither has to import the
// other.

export const NAV = [
  {
    label: 'Workspace',
    items: [
      { href: '/', label: 'Overview' },
      { href: '/orders', label: 'Orders' },
      { href: '/customers', label: 'Customers' },
      { href: '/reports', label: 'Reports', tag: 'slow' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/settings/profile', label: 'Profile' },
      { href: '/settings/team', label: 'Team' },
    ],
  },
  {
    label: 'Developer',
    items: [
      { href: '/diagnostics', label: 'Diagnostics', tag: 'throws' },
      { href: '/warehouse', label: 'Warehouse', tag: '404' },
    ],
  },
];

const LABELS = {
  orders: 'Orders',
  customers: 'Customers',
  reports: 'Reports',
  settings: 'Settings',
  profile: 'Profile',
  team: 'Team',
  diagnostics: 'Diagnostics',
  signin: 'Sign in',
};

export function crumbFor(path) {
  if (path === '/') return ['Overview'];
  const segments = path.split('/').filter(Boolean);
  return segments.map((s) => LABELS[s] ?? s);
}
