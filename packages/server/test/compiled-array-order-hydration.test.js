// A compiled array's members hydrate in document order: the children a
// component is given, a fragment a component returns, a <Show>'s content, a
// <For> or .map() row of several nodes, a fragment inside another. While
// hydrating, an element or a component claims the server's nodes when it is
// created, and the other members (text, a reactive child, a list, a
// conditional) used to be adopted only when the array was placed, after them
// all: `<Button>Save <Icon /></Button>` gave the icon the server's text node,
// and the page showed "<icon>Save". A hydratable build now creates such an
// array's members in order and adopts each where it stands (_$members).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const env = installDOM();
const { h, hydrate, flushSync } = await import('what-core');
const { __resetHydrationData } = await import('what-core/internal');
const { renderToHydratableString } = await import('../src/index.js');

// The members, in the orders that went wrong: text, a reactive child, a
// keyed list or a conditional before an element or a component, and a static
// element before one whose setup is hoisted (a binding, a form field's prop).
const MEMBERS = {
  'text, element': 'Save <b id="m1">1</b>',
  'element, text, element': '<b id="m1">1</b> and <b id="m2">2</b>',
  'reactive child, element': '{t()}<b id="m1">1</b>',
  'element, reactive child, element': '<b id="m1">1</b>{t()}<b id="m2">2</b>',
  'element, keyed list, element': '<b id="m1">1</b>{xs().map((x) => <i key={x} id={"m-" + x}>{x}</i>)}<b id="m2">2</b>',
  'element, conditional, element': '<b id="m1">1</b>{t() && <i id="mc">c</i>}<b id="m2">2</b>',
  'component, reactive child, component': '<C id="m1" />{t()}<C id="m2" />',
  'static element, bound element': '<b id="m1">1</b><b id="m2" title={t()}>2</b>',
  'static fields, a field with a default': '<input id="m1" /><input id="m2" /><input id="m3" defaultValue={t()} />',
  'element, fragment': '<b id="m1">1</b><><i id="m2" title={t()}>2</i>{t()}</>',
};

// Where an array of them stands. `{k}` is replaced by the members.
const PLACES = {
  "a component's children": 'function W(props) { return <section>{props.children}</section>; } export function Page() { return <main><W>{k}</W></main>; }',
  'a fragment a component returns': 'function R() { return <>{k}</>; } export function Page() { return <main><R /><p>after</p></main>; }',
  "a <Show>'s content": 'export function Page() { return <main><Show when={t()}>{k}</Show></main>; }',
  'a <For> row': 'export function Page() { return <main><For each={xs}>{(x) => <>{k}</>}</For></main>; }',
  'a .map() row': 'export function Page() { return <main>{xs().map((x) => <>{k}</>)}</main>; }',
  'a reactive child': 'export function Page() { return <main>{() => t() && <>{k}</>}</main>; }',
};

describe('a compiled array, hydrated', () => {
  for (const [place, page] of Object.entries(PLACES)) {
    for (const [members, jsx] of Object.entries(MEMBERS)) {
      it(`${members}, in ${place}: adopted in order, and live`, async () => {
        const source = `
          import { signal, Show, For } from 'what-framework';
          export const t = signal('T0');
          export const xs = signal([1, 2]);
          function C(props) { return <i id={props.id}>c</i>; }
          ${page.replace('{k}', jsx)}`;
        const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
        const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
        __resetHydrationData();
        document.body.innerHTML = renderToHydratableString(h(server.Page));
        const main = document.querySelector('main');
        const text = main.textContent;
        const order = [...main.querySelectorAll('[id]')].map((el) => el.id).join(' ');
        const serverElements = [...main.querySelectorAll('*')];
        const problems = [];
        const stop = hydrate(h(client.Page), document.body, { onHydrationError: (info) => problems.push(`${info.kind}: ${info.expected} / ${info.found}`) });
        try {
          assert.deepEqual(problems, []);
          assert.equal(main.textContent, text, 'the page shows what the server rendered, in its order');
          assert.equal([...main.querySelectorAll('[id]')].map((el) => el.id).join(' '), order);
          assert.deepEqual(serverElements.filter((el) => !el.isConnected).map((el) => el.id || el.localName), [], 'no server element is replaced');
          client.t('T1');
          flushSync();
          assert.equal(main.textContent, text.replaceAll('T0', 'T1'), 'its reactive members update in place');
        } finally {
          stop();
        }
      });
    }
  }
});

process.on('exit', () => env.cleanup());
