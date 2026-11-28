// A deterministic inventory of 10,000 SKUs.
//
// Seeded, so every run (and the smoke check) sees the same rows: the check can
// name a row by id and know its price. Ten warehouses hold exactly 1,000 rows
// each (warehouse = index % 10), which is what makes "filter to one warehouse,
// select all, apply a bulk change" touch exactly 1,000 rows.

export const ROW_COUNT = 10_000;

export const WAREHOUSES = [
  'Austin', 'Berlin', 'Chennai', 'Dublin', 'Eindhoven',
  'Fresno', 'Gdansk', 'Hanoi', 'Izmir', 'Jakarta',
];

export const STATUSES = ['in stock', 'low', 'backorder', 'discontinued'];

const NOUNS = [
  'bolt', 'bracket', 'bearing', 'cable', 'clamp', 'coupler', 'flange', 'gasket',
  'hinge', 'hose', 'latch', 'lever', 'nozzle', 'panel', 'pulley', 'relay',
  'rivet', 'sensor', 'spring', 'switch', 'valve', 'washer', 'wheel', 'fan',
];
const ADJECTIVES = [
  'brass', 'steel', 'nylon', 'copper', 'carbon', 'ceramic', 'rubber', 'zinc',
  'alloy', 'titanium', 'vinyl', 'cobalt',
];

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

export function makeRows(count = ROW_COUNT, seed = 20261126) {
  const rand = mulberry32(seed);
  const rows = new Array(count);
  for (let i = 0; i < count; i++) {
    const adjective = ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(rand() * NOUNS.length)];
    rows[i] = {
      id: i + 1,
      sku: `SKU-${String(i + 1).padStart(5, '0')}`,
      name: `${adjective} ${noun} ${Math.floor(rand() * 90) + 10}`,
      warehouse: WAREHOUSES[i % WAREHOUSES.length],
      status: STATUSES[Math.floor(rand() * STATUSES.length)],
      qty: Math.floor(rand() * 500),
      // Whole cents, so sums are exact and the check can compare them.
      price: Math.floor(rand() * 50_000 + 100) / 100,
    };
  }
  return rows;
}

export const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const count = (n) => n.toLocaleString('en-US');
