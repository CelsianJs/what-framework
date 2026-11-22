// A <noscript>'s content is the server's alone, as in React: the server writes
// it, and a browser with scripts on parses it as text, so the client neither
// builds it (a mount leaves the element empty) nor hydrates it (the server's
// text stays, and nothing is reported). Before, hydration tried to claim a
// <button> over that text and reported ERR_HYDRATION_MISMATCH at
// form>noscript>#text. Checked on the h() path, compiled JSX and a spread
// element.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const env = installDOM();
const { h, hydrate, mount } = await import('what-core');
const { renderToHydratableString, renderToString } = await import('../src/index.js');

const source = `
  import { signal } from 'what-framework';
  export function Plain() {
    return <form><noscript><button type="submit">Save</button></noscript><p>after</p></form>;
  }
  export function Bound() {
    const label = signal('Save');
    return <form><noscript class={label()}><button onClick={() => label('x')}>{label()}</button></noscript><p>{label()}</p></form>;
  }
  export function Spread(props) {
    return <form><noscript {...props}><button type="submit">Save</button></noscript><p>after</p></form>;
  }
`;
const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
const dom = await loadCompiled(source, {});

const hPlain = () => h('form', null, h('noscript', null, h('button', { type: 'submit' }, 'Save')), h('p', null, 'after'));
const hSpread = (props) => h('form', null, h('noscript', { ...props }, h('button', { type: 'submit' }, 'Save')), h('p', null, 'after'));

const cases = [
  ['h()', () => h(hPlain), () => h(hPlain)],
  ['h() spread', () => h(hSpread, { id: 'fallback' }), () => h(hSpread, { id: 'fallback' })],
  ['compiled', () => h(server.Plain), () => h(client.Plain)],
  ['compiled, bound', () => h(server.Bound), () => h(client.Bound)],
  ['compiled spread', () => h(server.Spread, { id: 'fallback' }), () => h(client.Spread, { id: 'fallback' })],
];

// What a browser with scripts on makes of the server's markup: a <noscript>'s
// content is its raw text.
function asParsedWithScripts(host) {
  for (const el of host.querySelectorAll('noscript')) el.textContent = el.innerHTML;
}

describe('<noscript> on the client', () => {
  for (const [name, serverView, clientView] of cases) {
    it(`${name}: the server writes the content, hydration keeps it as the browser's text and reports nothing`, () => {
      const html = renderToHydratableString(serverView());
      assert.match(html, /<noscript[^>]*><button[^>]*>(<!--\$-->)?Save(<!--\/\$-->)?<\/button><\/noscript>/);
      const host = document.createElement('div');
      document.body.appendChild(host);
      host.innerHTML = html;
      asParsedWithScripts(host);
      const noscript = host.querySelector('noscript');
      const text = noscript.firstChild;
      const after = host.querySelector('p');
      const reports = [];
      const stop = hydrate(clientView(), host, { onHydrationError: (info) => reports.push(`${info.kind} ${info.path}`) });
      try {
        assert.deepEqual(reports, []);
        assert.equal(host.querySelector('noscript'), noscript);
        assert.equal(noscript.firstChild, text);
        assert.equal(noscript.childNodes.length, 1);
        assert.match(text.data, /<button[^>]*>.*Save.*<\/button>/);
        assert.equal(host.querySelector('p'), after);
      } finally {
        stop();
        host.remove();
      }
    });
  }

  it('a client render leaves a <noscript> empty, on every path', () => {
    for (const view of [() => h(hPlain), () => h(hSpread, { id: 'fallback' }), () => h(dom.Plain), () => h(dom.Bound), () => h(dom.Spread, { id: 'fallback' })]) {
      const host = document.createElement('div');
      const stop = mount(view(), host);
      try {
        assert.equal(host.querySelector('noscript').childNodes.length, 0, host.innerHTML);
        assert.equal(host.querySelector('button'), null);
        assert.ok(host.querySelector('p'));
      } finally {
        stop();
      }
    }
  });

  it('the server keeps rendering it, in a plain render too', () => {
    assert.match(renderToString(h(hPlain)), /<noscript><button type="submit">Save<\/button><\/noscript>/);
    assert.match(renderToString(h(server.Plain)), /<noscript><button type="submit">Save<\/button><\/noscript>/);
  });
});

process.on('exit', () => env.cleanup());
