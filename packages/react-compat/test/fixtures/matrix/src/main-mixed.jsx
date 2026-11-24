// The mixed entry, a native What file. ?variant=mixed mounts a generated
// native host that renders the fixture's React file as an island;
// ?variant=native mounts the fixture's native.jsx, a native What file that
// uses the package's components directly.
import { mount } from 'what-framework';
import { libs } from 'virtual:matrix';

const query = new URLSearchParams(location.search);
const load = libs[query.get('lib')]?.[query.get('variant') || 'mixed'];
if (!load) {
  window.loadError = `no fixture named ${query.get('lib')} (${query.get('variant')})`;
} else {
  load().then((mod) => {
    const Host = mod.default;
    mount(<Host />, '#main');
    window.ready = true;
  }).catch((e) => { window.loadError = String((e && e.stack) || e); });
}
