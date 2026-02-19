/**
 * Test: react-helmet-async — manage document head (title, meta tags)
 * 2.3M weekly downloads. Context (async version), side-effects for DOM head.
 */
import { Helmet, HelmetProvider } from 'react-helmet-async';

export function HelmetTest() {
  return (
    <HelmetProvider>
      <div>
        <Helmet>
          <title>what-react compat test — Helmet active</title>
          <meta name="description" content="Testing react-helmet-async on What Framework" />
        </Helmet>
        <p style={{ fontSize: '13px' }}>
          Document title set to: <code>"what-react compat test — Helmet active"</code>
        </p>
        <p style={{ fontSize: '13px', color: '#666' }}>
          Meta description set to: <code>"Testing react-helmet-async on What Framework"</code>
        </p>
        <p style={{ color: 'green' }} id="helmet-status">React Helmet loaded OK</p>
      </div>
    </HelmetProvider>
  );
}
