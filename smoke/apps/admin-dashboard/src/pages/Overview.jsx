// Overview.
//
// The "Live feed" card is the ErrorBoundary proof. A component that reads a
// signal in its body and throws would never fire the boundary: components run
// ONCE, so flipping the signal never re-executes it. The throw has to come from
// a component CREATED during a reactive re-render, which is why the boundary's
// child is a thunk that picks between two components.

import { ErrorBoundary, signal } from 'what-framework';
import { Link, navigate } from 'what-router';

import { CUSTOMERS, ORDERS, PENDING, REVENUE, TRAFFIC, formatMoney } from '../data.js';
import { draftOrders } from '../state/ui.js';

const feedBroken = signal(false, 'overview:feedBroken');

const FEED = [
  { id: 'f-1', at: '09:41', text: 'NW-2047 captured — $216.00' },
  { id: 'f-2', at: '09:38', text: 'Radia Perlman upgraded to Scale' },
  { id: 'f-3', at: '09:31', text: 'Refund issued on NW-2043' },
  { id: 'f-4', at: '09:12', text: 'Webhook delivery recovered (eu-west)' },
];

function LiveFeed() {
  return (
    <ul class="feed" data-feed>
      {FEED.map((e) => (
        <li key={e.id} data-feed-item={e.id}>
          <span class="mono muted">{e.at}</span> {e.text}
        </li>
      ))}
    </ul>
  );
}

// Stands in for a component that blows up on a bad payload once the socket has
// already been rendering fine for a while.
function BrokenFeed() {
  throw new Error('Feed socket closed: upstream returned 502');
}

// Props are read off `props`, not destructured in the parameter list. The
// compiler classifies every destructured parameter name as a signal, so
// `data-stat={label}` from a destructured `{ label }` compiles to
// `setAttr(el, 'data-stat', label())` and throws "label is not a function" at
// runtime, while the same identifier used as a CHILD compiles to `() => label`
// and does not. Reported with the run; this is the workaround.
function Stat(props) {
  return (
    <div class="card">
      <div class="stat-label">{props.label}</div>
      <div class="stat-value" data-stat={props.label}>{props.value}</div>
      <div class={`stat-delta ${props.direction}`}>{props.delta}</div>
    </div>
  );
}

export default function Overview() {
  const peak = Math.max(...TRAFFIC.map((d) => d.value));

  return (
    <>
      <div class="page-head">
        <div>
          <h1>Overview</h1>
          <p>Seven day rolling window across every region.</p>
        </div>
        <div class="page-head-actions">
          <button class="primary" data-goto-orders onclick={() => navigate('/orders')}>
            Review orders
          </button>
        </div>
      </div>

      <div class="stat-grid">
        <Stat label="Revenue" value={formatMoney(REVENUE)} delta="+12.4% vs last week" direction="up" />
        <Stat label="Orders" value={String(ORDERS.length)} delta="+3 today" direction="up" />
        <Stat label="Customers" value={String(CUSTOMERS.length)} delta="+1 this week" direction="up" />
        <Stat label="Awaiting capture" value={String(PENDING)} delta="2 over 24h" direction="down" />
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Sessions</h2>
          <span class="muted mono">peak {peak}k</span>
        </div>
        <div class="spark" role="img" aria-label="Seven day session volume">
          {TRAFFIC.map((d) => (
            <span key={d.day} title={`${d.day}: ${d.value}k`} style={`height:${(d.value / peak) * 100}%`} />
          ))}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Live feed</h2>
          <button class="danger" data-break-feed onclick={() => feedBroken(true)}>
            Simulate socket failure
          </button>
        </div>

        <ErrorBoundary
          fallback={({ error, reset }) => (
            <div class="notice" data-feed-error>
              <strong>Live feed unavailable</strong>
              <p class="muted" data-feed-error-msg>{error.message}</p>
              <button
                data-feed-retry
                onclick={() => {
                  feedBroken(false);
                  reset();
                }}
              >
                Reconnect
              </button>
            </div>
          )}
        >
          {() => (feedBroken() ? <BrokenFeed /> : <LiveFeed />)}
        </ErrorBoundary>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Session drafts</h2>
          <Link href="/orders" class="muted">All orders</Link>
        </div>
        {() =>
          draftOrders().length === 0
            ? <p class="muted" data-no-drafts>No drafts yet. Use "New order" in the topbar.</p>
            : (
              <ul data-draft-list>
                {draftOrders().map((d) => (
                  <li key={d.id} data-draft={d.id}>{d.id} · {d.customer}</li>
                ))}
              </ul>
            )
        }
      </div>
    </>
  );
}
