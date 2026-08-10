// Order detail.
//
// Params arrive as a PROP from the router (h(component, { params, query, route
// })), not via useParams(). Both work, but reading the params signal inside a
// component body would subscribe the router's own reactive region to a signal
// the region itself writes on every match, and matchRoute hands back a fresh
// object each time.

import { Link, navigate } from 'what-router';

import { findOrder, formatMoney } from '../data.js';

export default function OrderDetail(props) {
  const id = props.params.id;
  const order = findOrder(id);

  if (!order) {
    return (
      <div class="notice" data-order-missing>
        <strong>No order {id}</strong>
        <p class="muted">It may have been archived.</p>
        <Link href="/orders">Back to orders</Link>
      </div>
    );
  }

  return (
    <>
      <div class="page-head">
        <div>
          <h1 data-order-id>{order.id}</h1>
          <p>{order.customer} · {order.email}</p>
        </div>
        <div class="page-head-actions">
          <button class="ghost" data-back onclick={() => navigate('/orders')}>Back to orders</button>
        </div>
      </div>

      <div class="card">
        <dl class="detail-grid">
          <div>
            <dt>Total</dt>
            <dd data-order-total>{formatMoney(order.total)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd><span class={`pill ${order.status}`}>{order.status}</span></dd>
          </div>
          <div>
            <dt>Region</dt>
            <dd>{order.region}</dd>
          </div>
          <div>
            <dt>Line items</dt>
            <dd>{String(order.items)}</dd>
          </div>
          <div>
            <dt>Placed</dt>
            <dd>{order.placed}</dd>
          </div>
        </dl>
      </div>
    </>
  );
}
