// A frozen dataset. The demo and the smoke run must see identical numbers, so
// nothing here is random or clock-dependent: every assertion about a sorted
// order or a total is reproducible.

export const ORDERS = [
  { id: 'NW-2041', customer: 'Ada Lovelace', email: 'ada@analytical.io', region: 'EU', total: 18400, status: 'paid', placed: '2026-07-02', items: 3 },
  { id: 'NW-2042', customer: 'Grace Hopper', email: 'grace@cobol.dev', region: 'NA', total: 96250, status: 'paid', placed: '2026-06-28', items: 11 },
  { id: 'NW-2043', customer: 'Alan Turing', email: 'alan@bletchley.uk', region: 'EU', total: 4100, status: 'refunded', placed: '2026-07-05', items: 1 },
  { id: 'NW-2044', customer: 'Katherine Johnson', email: 'kj@orbital.space', region: 'NA', total: 52900, status: 'pending', placed: '2026-07-01', items: 6 },
  { id: 'NW-2045', customer: 'Radia Perlman', email: 'radia@spanning.net', region: 'APAC', total: 133000, status: 'paid', placed: '2026-06-30', items: 24 },
  { id: 'NW-2046', customer: 'Barbara Liskov', email: 'barbara@substitution.org', region: 'NA', total: 7350, status: 'pending', placed: '2026-07-04', items: 2 },
  { id: 'NW-2047', customer: 'Jean Bartik', email: 'jean@eniac.mil', region: 'EU', total: 21600, status: 'paid', placed: '2026-07-03', items: 4 },
];

export const TEAM = [
  { id: 'u-1', name: 'Ines Okafor', role: 'Owner', email: 'ines@northwind.ops', lastSeen: '2 minutes ago' },
  { id: 'u-2', name: 'Tomas Vidal', role: 'Admin', email: 'tomas@northwind.ops', lastSeen: '1 hour ago' },
  { id: 'u-3', name: 'Priya Raman', role: 'Support', email: 'priya@northwind.ops', lastSeen: 'Yesterday' },
  { id: 'u-4', name: 'Otto Lindqvist', role: 'Billing', email: 'otto@northwind.ops', lastSeen: '3 days ago' },
];

/** Customers are derived from orders so the two pages can never disagree. */
export const CUSTOMERS = Object.values(
  ORDERS.reduce((acc, o) => {
    acc[o.email] ??= { email: o.email, name: o.customer, region: o.region, orders: 0, lifetime: 0 };
    acc[o.email].orders += 1;
    acc[o.email].lifetime += o.total;
    return acc;
  }, {}),
).sort((a, b) => b.lifetime - a.lifetime);

export function findOrder(id) {
  return ORDERS.find((o) => o.id === id) ?? null;
}

export function formatMoney(cents) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const REVENUE = ORDERS.filter((o) => o.status !== 'refunded').reduce((n, o) => n + o.total, 0);
export const PENDING = ORDERS.filter((o) => o.status === 'pending').length;

/** Seven days of sparkline input. Objects, not numbers, so every list in this
 *  app can carry a stable key and take the compiler's keyed path. */
export const TRAFFIC = [
  { day: 'Mon', value: 12 }, { day: 'Tue', value: 19 }, { day: 'Wed', value: 14 },
  { day: 'Thu', value: 27 }, { day: 'Fri', value: 31 }, { day: 'Sat', value: 24 },
  { day: 'Sun', value: 38 },
];
