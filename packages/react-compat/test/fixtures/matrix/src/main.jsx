// The React entry: real React in the `react` build, what-react (aliased by
// reactCompat()) in the `compat` build. ?lib=<fixture> picks the fixture.
import { createRoot } from 'react-dom/client';
import { libs } from 'virtual:matrix';

const query = new URLSearchParams(location.search);
const load = libs[query.get('lib')]?.fixture;
if (!load) {
  window.loadError = `no fixture named ${query.get('lib')}`;
} else {
  load().then((mod) => {
    const Fixture = mod.default;
    createRoot(document.getElementById('main')).render(<Fixture />);
    window.ready = true;
  }).catch((e) => { window.loadError = String((e && e.stack) || e); });
}
