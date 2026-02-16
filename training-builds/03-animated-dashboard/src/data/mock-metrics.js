export const METRICS = [
  { id: 'revenue', label: 'Revenue', prefix: '$', format: 'currency' },
  { id: 'users', label: 'Active Users', format: 'number' },
  { id: 'orders', label: 'Orders', format: 'number' },
  { id: 'conversion', label: 'Conversion', suffix: '%', format: 'percent' },
  { id: 'avgOrder', label: 'Avg Order', prefix: '$', format: 'currency' },
  { id: 'satisfaction', label: 'Satisfaction', suffix: '/5', format: 'rating' },
];

export function generateMetrics() {
  return {
    revenue: Math.floor(Math.random() * 100000) + 50000,
    users: Math.floor(Math.random() * 5000) + 1000,
    orders: Math.floor(Math.random() * 500) + 100,
    conversion: +(Math.random() * 5 + 1).toFixed(1),
    avgOrder: +(Math.random() * 100 + 20).toFixed(2),
    satisfaction: +(Math.random() * 2 + 3).toFixed(1),
  };
}
