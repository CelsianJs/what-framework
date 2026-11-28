import { applyStreamedBoundaries, flushSync, h, hydrate, mount, settled } from 'what-framework';
import { captureDiagnostics } from 'what-framework/testing';
import { act, interactionState, recallElements, replacedElements, view } from './storefront-observations.js';

export async function settleClient() {
  // A microtask checkpoint drains the resource and island work queued by setup.
  await new Promise(resolve => queueMicrotask(resolve));
  await new Promise(resolve => queueMicrotask(resolve));
  flushSync();
  // Then whatever is still fetching or in a transition lands and commits.
  await settled();
}

export async function exerciseStorefront(createStorefront, mode) {
  const fresh = mode === 'client';
  if (mode.endsWith('noScripts')) applyStreamedBoundaries();
  const before = fresh ? [] : recallElements(document);
  const serverView = fresh ? null : view(document);
  const fetches = [];
  const Page = createStorefront({
    fetchStock: async () => { fetches.push('stock'); return 'In stock today'; },
    fetchDelivery: async () => { fetches.push('delivery'); return 'Delivery tomorrow'; },
    // A request made with an aborted signal is not sent, as with fetch.
    fetchRating: async (signal) => {
      if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      fetches.push('rating');
      return '4.5';
    },
    saveLike: () => new Promise(resolve => setTimeout(resolve, 1)),
    // A static HTML fragment has no loader payload. The host provides its
    // initial loader value, as it does for a client-only mount.
    initialCustomer: ['client', 'string', 'hydratable'].includes(mode) ? 'Ada' : undefined,
  });
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(String(args[0]));
  let stop;
  let setup;
  let replaced;
  let settledView;
  let headCounts;
  let optimisticLike;
  let originalRow;
  let originalInput;
  const counter = countCreatedNodes(document);
  const budgets = [];
  // The session capture stays open from the mount to the last interaction, so
  // the effects the page creates are known to each interaction's capture,
  // which can then pin an effect that stayed idle at zero runs.
  await captureDiagnostics(async () => {
    try {
      setup = await captureDiagnostics(async () => {
        if (fresh) stop = mount(h(Page), document.body);
        else stop = hydrate(h(Page), document.body);
        await settleClient();
      });
    } finally {
      console.warn = warn;
      counter.stop();
    }
    replaced = replacedElements(document, before);
    settledView = view(document);
    headCounts = ['application-name', 'description'].map(name =>
      document.head.querySelectorAll('meta[name="' + name + '"]').length);

    originalRow = document.querySelector('#pear');
    originalInput = document.querySelector('#name');
    for (const type of ['input', 'sort', 'cart', 'like']) {
      const captured = await captureDiagnostics(async () => {
        act(document, type);
        if (type === 'like') {
          // The overlay shows in the click's own flush, before the save lands.
          flushSync();
          optimisticLike = document.querySelector('#like').textContent;
        }
        await settleClient();
      });
      budgets.push(captured);
    }
  });
  const interaction = interactionState(document);
  const retainedAfterSort = originalRow === document.querySelector('#pear') && originalInput === document.querySelector('#name');
  stop();
  return { budgets, events: setup.events, warnings, serverView, replaced, settled: settledView, headCounts, fetches, interaction, retainedAfterSort, optimisticLike, created: counter.created };
}

// The nodes in the page's body that were not there before it started:
// adopting matching markup adds none.
function countCreatedNodes(document) {
  const before = new Set();
  const walk = (visit) => {
    const walker = document.createTreeWalker(document.body, document.defaultView.NodeFilter.SHOW_ALL);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) visit(node);
  };
  walk((node) => before.add(node));
  const counter = {
    created: 0,
    stop() {
      walk((node) => { if (!before.has(node)) counter.created++; });
    },
  };
  return counter;
}
