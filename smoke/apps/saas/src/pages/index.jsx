// The marketing page at the app's root.

import { Link } from 'what-router';
import { loadPage } from '../loaders.js';

export const loader = (ctx) => loadPage(ctx);

const PLANS = [
  { name: 'Team', price: 12, blurb: 'For one team and its projects.' },
  { name: 'Scale', price: 29, blurb: 'Every team, SSO and an audit log.' },
  { name: 'Enterprise', price: null, blurb: 'Your own region and a contract.' },
];

export default function Home() {
  return (
    <main class="marketing" data-page="home">
      <section class="hero">
        <h1>Ship the roadmap, not the spreadsheet.</h1>
        <p>Northstar keeps every project, issue and teammate of your company in one place.</p>
        <Link href="/org/acme" class="button primary" data-cta>Open the Acme console</Link>
      </section>
      <section class="plans">
        {PLANS.map((p) => (
          <article class="plan" key={p.name} data-plan={p.name}>
            <h2>{p.name}</h2>
            <p class="price">{p.price === null ? 'Talk to us' : `$${p.price} / seat`}</p>
            <p>{p.blurb}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
