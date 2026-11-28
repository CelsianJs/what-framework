// The React entry: real React in the `react` build, what-react (aliased by
// reactCompat()) in the `compat` build. ?lib=<fixture> picks the fixture.
// A page the server rendered (matrix-browser.mjs --serve=ssr sets
// window.__ssr) is hydrated; any other is mounted.
import { createRoot, hydrateRoot } from 'react-dom/client';
import { libs } from 'virtual:matrix';

const query = new URLSearchParams(location.search);
const load = libs[query.get('lib')]?.fixture;
if (!load) {
  window.loadError = `no fixture named ${query.get('lib')}`;
} else {
  load().then((mod) => {
    const Fixture = mod.default;
    const main = document.getElementById('main');
    if (window.__ssr && window.__ssr.rendered) {
      hydrateRoot(main, <Fixture />, { onRecoverableError: (e) => { (window.__recoverable ||= []).push(String((e && e.message) || e)); } });
    } else {
      createRoot(main).render(<Fixture />);
    }
    window.ready = true;
  }).catch((e) => { window.loadError = String((e && e.stack) || e); });
}
