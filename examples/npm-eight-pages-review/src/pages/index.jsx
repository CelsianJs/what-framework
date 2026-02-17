import { Link } from 'what-framework/router';

const FEATURE_ROUTES = [
  { href: '/signals', title: 'Signals + Computed', desc: 'Reactive state updates with no component re-renders.' },
  { href: '/lists', title: 'For / Show / Switch', desc: 'List rendering and conditional branching primitives.' },
  { href: '/forms', title: 'useForm + ErrorMessage', desc: 'Validation rules and field error rendering.' },
  { href: '/data', title: 'useSWR', desc: 'Cache-backed async fetching with revalidation.' },
  { href: '/store', title: 'createStore + derived', desc: 'Global state and derived selectors.' },
  { href: '/focus', title: 'FocusTrap + restore', desc: 'Accessible modal focus management.' },
  { href: '/html', title: 'innerHTML paths', desc: 'HTML + SVG injection behavior checks.' },
];

export const page = {
  mode: 'client',
};

export default function HomePage() {
  return (
    <section>
      <h1 class="page-title">8-page npm consumer walkthrough</h1>
      <p class="lead">
        This app was scaffolded with <code>create-what@0.4.2</code> and uses published npm packages only.
      </p>

      <div class="card-grid">
        {FEATURE_ROUTES.map((item) => (
          <Link href={item.href} class="card card-link">
            <h2>{item.title}</h2>
            <p>{item.desc}</p>
            <span class="inline-link">Open page</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
