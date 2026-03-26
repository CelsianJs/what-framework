// Dashboard Store — signal-based data store with fake data generator
// Demonstrates: useSignal, useComputed, complex computed chains,
// multiple signals feeding into shared computeds

import { signal, computed, batch } from 'what-framework';

// ─── Fake Data Generator ──────────────────────────────────────
const firstNames = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Lisa', 'Daniel', 'Nancy',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle',
  'Kenneth', 'Carol', 'Kevin', 'Amanda', 'Brian', 'Dorothy', 'George', 'Melissa',
  'Timothy', 'Deborah',
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts',
];

const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'proton.me', 'company.io', 'work.co'];
const statuses = ['active', 'inactive', 'pending', 'cancelled'];
const statusWeights = [0.5, 0.2, 0.2, 0.1]; // weighted distribution

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted(items, weights) {
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < items.length; i++) {
    cumulative += weights[i];
    if (r <= cumulative) return items[i];
  }
  return items[items.length - 1];
}

function randomDate(startDays, endDays) {
  const now = Date.now();
  const start = now - startDays * 86400000;
  const end = now - endDays * 86400000;
  return new Date(start + Math.random() * (end - start));
}

function generateRow(id) {
  const first = pickRandom(firstNames);
  const last = pickRandom(lastNames);
  const name = `${first} ${last}`;
  const email = `${first.toLowerCase()}.${last.toLowerCase()}@${pickRandom(domains)}`;
  const amount = Math.round((Math.random() * 9900 + 100) * 100) / 100; // $1.00 - $99.99 * 100
  const status = pickWeighted(statuses, statusWeights);
  const date = randomDate(365, 0);

  return { id, name, email, amount, status, date: date.toISOString() };
}

export function generateData(count = 1000) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(generateRow(i + 1));
  }
  return rows;
}

// ─── Global Signals ───────────────────────────────────────────

export const data = signal([]);
export const searchQuery = signal('');
export const statusFilter = signal('all');
export const sortColumn = signal('id');
export const sortDirection = signal('asc');
export const currentPage = signal(1);
export const itemsPerPage = signal(25);
export const activeTab = signal('table'); // 'table' | 'charts' | 'settings'
export const darkMode = signal(true);

// ─── Computed Chains ──────────────────────────────────────────
// filter -> sort -> paginate -> display

// Step 1: Filter by search query
export const searchFiltered = computed(() => {
  const rows = data();
  const query = searchQuery().toLowerCase().trim();
  if (!query) return rows;
  return rows.filter(row =>
    row.name.toLowerCase().includes(query) ||
    row.email.toLowerCase().includes(query)
  );
});

// Step 2: Filter by status
export const statusFiltered = computed(() => {
  const rows = searchFiltered();
  const status = statusFilter();
  if (status === 'all') return rows;
  return rows.filter(row => row.status === status);
});

// Step 3: Sort
export const sorted = computed(() => {
  const rows = statusFiltered();
  const col = sortColumn();
  const dir = sortDirection();
  const multiplier = dir === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (col === 'amount') {
      cmp = a.amount - b.amount;
    } else if (col === 'date') {
      cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
    } else if (col === 'id') {
      cmp = a.id - b.id;
    } else {
      cmp = String(a[col]).localeCompare(String(b[col]));
    }
    return cmp * multiplier;
  });
});

// Step 4: Pagination metadata
export const totalFiltered = computed(() => statusFiltered().length);

export const totalPages = computed(() => {
  const perPage = itemsPerPage();
  const total = totalFiltered();
  return Math.max(1, Math.ceil(total / perPage));
});

// Clamp current page to valid range
export const clampedPage = computed(() => {
  const page = currentPage();
  const max = totalPages();
  return Math.max(1, Math.min(page, max));
});

// Step 5: Paginated slice
export const paginated = computed(() => {
  const rows = sorted();
  const page = clampedPage();
  const perPage = itemsPerPage();
  const start = (page - 1) * perPage;
  return rows.slice(start, start + perPage);
});

// ─── Stats Computeds ──────────────────────────────────────────

export const stats = computed(() => {
  const rows = statusFiltered();
  if (rows.length === 0) {
    return { total: 0, sum: 0, avg: 0, active: 0, inactive: 0, pending: 0, cancelled: 0 };
  }

  let sum = 0;
  let active = 0;
  let inactive = 0;
  let pending = 0;
  let cancelled = 0;

  for (let i = 0; i < rows.length; i++) {
    sum += rows[i].amount;
    switch (rows[i].status) {
      case 'active': active++; break;
      case 'inactive': inactive++; break;
      case 'pending': pending++; break;
      case 'cancelled': cancelled++; break;
    }
  }

  return {
    total: rows.length,
    sum: Math.round(sum * 100) / 100,
    avg: Math.round((sum / rows.length) * 100) / 100,
    active,
    inactive,
    pending,
    cancelled,
  };
});

// Chart data: amount distribution by status (for bar chart)
export const chartData = computed(() => {
  const rows = statusFiltered();
  const buckets = { active: 0, inactive: 0, pending: 0, cancelled: 0 };

  for (let i = 0; i < rows.length; i++) {
    buckets[rows[i].status] += rows[i].amount;
  }

  return Object.entries(buckets).map(([label, value]) => ({
    label,
    value: Math.round(value * 100) / 100,
  }));
});

// Sparkline data: amounts over time (last 12 months)
export const sparklineData = computed(() => {
  const rows = data();
  const months = [];
  const now = new Date();

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, label: d.toLocaleDateString('en', { month: 'short' }), value: 0 });
  }

  for (let i = 0; i < rows.length; i++) {
    const rd = new Date(rows[i].date);
    const key = `${rd.getFullYear()}-${String(rd.getMonth() + 1).padStart(2, '0')}`;
    const bucket = months.find(m => m.key === key);
    if (bucket) bucket.value += rows[i].amount;
  }

  return months.map(m => ({
    label: m.label,
    value: Math.round(m.value * 100) / 100,
  }));
});

// ─── Actions ──────────────────────────────────────────────────

export function setSort(column) {
  batch(() => {
    if (sortColumn() === column) {
      sortDirection.set(sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      sortColumn.set(column);
      sortDirection.set('asc');
    }
    currentPage.set(1);
  });
}

export function setSearch(query) {
  batch(() => {
    searchQuery.set(query);
    currentPage.set(1);
  });
}

export function setStatusFilter(status) {
  batch(() => {
    statusFilter.set(status);
    currentPage.set(1);
  });
}

export function goToPage(page) {
  currentPage.set(page);
}

export function setPerPage(count) {
  batch(() => {
    itemsPerPage.set(count);
    currentPage.set(1);
  });
}

export function initData() {
  data.set(generateData(1000));
}
