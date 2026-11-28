// The org's plan (from the org's entry, which the shell already holds) and
// its invoices.

import { keys, useBilling, useOrg } from '../../../queries.js';
import { loadPage } from '../../../loaders.js';

export const loader = (ctx) => loadPage(ctx, (db) => [
  [keys.org(ctx.params.orgId), db.org(ctx.params.orgId)],
  [keys.billing(ctx.params.orgId), db.billing(ctx.params.orgId)],
]);

const money = (n) => `$${n.toLocaleString('en-US')}`;

export default function Billing({ params }) {
  const orgId = () => params.orgId;
  const org = useOrg(orgId);
  const billing = useBilling(orgId);
  return (
    <main class="page" data-page="billing">
      <h1>Billing</h1>
      <div class="card plan-card">
        <p>Plan <b data-plan-name>{org.data()?.plan ?? '…'}</b></p>
        <p class="muted">{org.data() ? `${org.data().members} of ${org.data().seats} seats` : ''}</p>
        <p class="muted" data-renews>{billing.data() ? `Renews ${billing.data().renews}` : 'Loading…'}</p>
      </div>
      <h2>Invoices</h2>
      <table class="table" data-invoices>
        <thead><tr><th>Invoice</th><th>Month</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>
          {(billing.data()?.invoices ?? []).map((inv) => (
            <tr key={inv.id} data-invoice={inv.id}>
              <td>{inv.id}</td>
              <td>{inv.month}</td>
              <td>{money(inv.amount)}</td>
              <td><span class={`pill ${inv.status}`}>{inv.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
