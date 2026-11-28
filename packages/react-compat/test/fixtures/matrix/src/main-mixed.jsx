// The mixed entry, a native What file. ?variant=mixed mounts a generated
// native host that renders the fixture's React file as an island;
// ?variant=native mounts the fixture's native.jsx, a native What file that
// uses the package's components directly. A page the server rendered
// (matrix-browser.mjs --serve=ssr sets window.__ssr) is hydrated instead.
import { mount, hydrate } from 'what-framework';
import { libs } from 'virtual:matrix';

const query = new URLSearchParams(location.search);
const load = libs[query.get('lib')]?.[query.get('variant') || 'mixed'];
if (!load) {
  window.loadError = `no fixture named ${query.get('lib')} (${query.get('variant')})`;
} else {
  load().then((mod) => {
    const Host = mod.default;
    if (window.__ssr && window.__ssr.rendered) hydrate(<Host />, document.getElementById('main'));
    else mount(<Host />, '#main');
    window.ready = true;
  }).catch((e) => { window.loadError = String((e && e.stack) || e); });
}
