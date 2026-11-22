// What the devtools hooks see of an async computed, with no change to
// what-devtools: the node on creation, each run with the inputs that caused
// it, its status in `devAsync`, and a rejection as an error.

import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { withResolvers } from '../../../test-utils/with-resolvers.js';

let env;
let W;
let internal;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
  internal = await import('../src/entries/internal.js');
});
after(() => {
  internal.__setDevToolsHooks(null);
  env.cleanup();
});

const drain = () => new Promise((resolve) => setImmediate(resolve));

it('sees an async computed\'s creation, runs with their causes, status and rejection', async () => {
  const { signal, computed, effect, createRoot } = W;
  const created = [];
  const runs = [];
  const errors = [];
  internal.__setDevToolsHooks({
    onSignalCreate() {}, onSignalUpdate() {}, onEffectDispose() {}, onComponentMount() {}, onComponentUnmount() {},
    onEffectCreate(node) { created.push(node); },
    onEffectRun(node, info) { runs.push({ node, causes: info?.causes ?? [] }); },
    onError(error, context) { errors.push({ error, context }); },
  });
  const id = signal(1, 'id');
  const flights = [];
  let user;
  const dispose = createRoot((d) => {
    user = computed(function user() {
      id();
      const flight = withResolvers();
      flights.push(flight);
      return flight.promise;
    });
    effect(() => { user(); });
    return d;
  });
  const node = created.find((n) => n.fn && /user/.test(n.fn.toString()) && 'subHead' in n);
  assert.ok(node, 'onEffectCreate handed out the async computed\'s node');
  assert.equal(node.devAsync, 'unresolved');
  flights[0].resolve('u1');
  await drain();
  assert.equal(node.devAsync, 'ready');
  id(2);
  user.peek();
  assert.equal(node.devAsync, 'pending');
  const rerun = runs.filter((r) => r.node === node).at(-1);
  assert.deepEqual(rerun.causes, [id], 'the run names the input that caused it');
  flights[1].reject(new Error('down'));
  await drain();
  assert.equal(node.devAsync, 'errored');
  assert.equal(errors.at(-1).error.message, 'down');
  assert.equal(errors.at(-1).context.type, 'async');
  assert.equal(errors.at(-1).context.effect, node);
  dispose();
});
