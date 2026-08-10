// Customers, with a client-side filter over the derived customer list.

import { computed, signal } from 'what-framework';

import { CUSTOMERS, formatMoney } from '../data.js';

export default function Customers() {
  const term = signal('', 'customers:term');

  const shown = computed(() => {
    const q = term().trim().toLowerCase();
    if (!q) return CUSTOMERS;
    return CUSTOMERS.filter((c) => `${c.name} ${c.email} ${c.region}`.toLowerCase().includes(q));
  });

  return (
    <>
      <div class="page-head">
        <div>
          <h1>Customers</h1>
          <p>Ranked by lifetime value.</p>
        </div>
        <div class="page-head-actions">
          <input
            data-customer-filter
            placeholder="Filter customers"
            value={() => term()}
            oninput={(e) => term(e.target.value)}
          />
        </div>
      </div>

      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Region</th>
              <th class="num">Orders</th>
              <th class="num">Lifetime</th>
            </tr>
          </thead>
          <tbody data-customer-body>
            {() => shown().map((c) => (
              <tr key={c.email} data-customer={c.email}>
                <td>
                  <div>{c.name}</div>
                  <div class="muted mono">{c.email}</div>
                </td>
                <td>{c.region}</td>
                <td class="num">{String(c.orders)}</td>
                <td class="num">{formatMoney(c.lifetime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {() => (shown().length === 0 ? <p class="muted" data-customers-empty>Nothing matches that filter.</p> : null)}
      </div>
    </>
  );
}
