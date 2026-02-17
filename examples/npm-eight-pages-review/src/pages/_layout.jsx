import { SkipLink } from 'what-framework';
import { Link } from 'what-framework/router';

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/signals', label: 'Signals' },
  { href: '/lists', label: 'Lists' },
  { href: '/forms', label: 'Forms' },
  { href: '/data', label: 'Data' },
  { href: '/store', label: 'Store' },
  { href: '/focus', label: 'Focus' },
  { href: '/html', label: 'HTML' },
];

export default function RootLayout({ children }) {
  return (
    <div class="shell">
      <SkipLink href="#main-content">Skip to main content</SkipLink>

      <header class="topbar">
        <div class="brand">What Framework npm review app</div>
        <nav class="nav-links" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <Link href={item.href} class="nav-link" activeClass="is-active">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main-content" class="page" tabIndex="-1">
        {children}
      </main>
    </div>
  );
}
