// Randomized: synchronous writes, writes inside transitions, async landings
// and failures, refreshes, disposals and remounts, in seeded orders, against a
// model of what each binding shows (docs/ASYNC.md). Time-bounded: it runs as
// many seeds as fit in the budget and always at least the first few.

import { it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let W;
before(async () => {
  env = installDOM();
  W = await import('../src/index.js');
});
after(() => env.cleanup());

const drain = () => new Promise((resolve) => setImmediate(resolve));
const BUDGET_MS = 8000;
const SEEDS = 400;
const STEPS = 30;

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The model: what each binding of the observer shows after the step settles.
//   id     'id <n>': a plain write shows at once; one inside a transition (and
//          any write while that transition is open) shows when it commits
//   user   the last run that landed for the current id ('v:<flight>' or
//          'e:failed <flight>'); nothing before the first; while a transition
//          is open, held until it commits
//   pending  a run in flight, and a value to show meanwhile
//   other  shows at once, always
function model() {
  const s = {
    mounted: false, id: 1, shownId: 1, other: 'a', shownOther: 'a',
    current: null, hasValue: false, shownUser: '', open: false, starts: 0, flights: 0,
  };
  const start = () => {
    s.starts++;
    s.current = 'f' + s.flights++;
  };
  return {
    s,
    mount() {
      s.mounted = true;
      s.hasValue = false;
      s.shownUser = '';
      s.shownId = s.id;
      s.shownOther = s.other;
      s.open = false;
      start();
    },
    dispose() {
      s.mounted = false;
      s.current = null;
      s.open = false;
    },
    writeId(v, inTransition) {
      if (v === s.id) return;
      s.id = v;
      if (!s.mounted) return;
      start();
      if (inTransition) s.open = true;
      else if (!s.open) s.shownId = v;
    },
    writeOther(v) {
      s.other = v;
      if (s.mounted) s.shownOther = v;
    },
    refresh() {
      start();
    },
    land(flight, ok) {
      if (!s.mounted || flight !== s.current) return;
      s.current = null;
      if (ok) s.hasValue = true;
      s.shownUser = (ok ? 'v:' : 'e:failed ') + flight;
      if (s.open) {
        s.open = false;
        s.shownId = s.id;
      }
    },
    view() {
      if (!s.mounted) return null;
      return { id: 'id ' + s.shownId, user: s.shownUser, pending: s.current !== null && s.hasValue, other: s.shownOther };
    },
  };
}

async function runSeed(seed) {
  const { signal, computed, refresh, startTransition, h, mount, settled } = W;
  const random = mulberry32(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const m = model();
  const id = signal(1);
  const other = signal('a');
  const flights = new Map();
  let starts = 0;
  let user = null;
  let stop = null;
  const host = document.createElement('div');
  function Observer() {
    user = computed(({ signal: abort }) => {
      id();
      const name = 'f' + starts++;
      const flight = Promise.withResolvers();
      flights.set(name, { ...flight, abort });
      return flight.promise;
    });
    return h('div', null,
      h('b', null, () => 'id ' + id()),
      h('i', null, () => {
        try {
          return 'v:' + user();
        } catch (error) {
          if (error instanceof Error) return 'e:' + error.message;
          throw error;
        }
      }),
      h('s', null, () => String(user.pending())),
      h('u', null, () => other()));
  }
  const read = () => {
    if (stop === null) return null;
    const [b, i, s, u] = host.querySelector('div').children;
    return { id: b.textContent, user: i.textContent, pending: s.textContent === 'true', other: u.textContent };
  };
  const trace = [];
  const doMount = () => {
    m.mount();
    stop = mount(h(Observer), host);
  };
  doMount();
  try {
    for (let step = 0; step < STEPS; step++) {
      const inFlight = [...flights.entries()].filter(([, f]) => !f.done);
      const ops = ['id', 'id', 'transition', 'transition', 'other', 'land', 'land', 'land', 'fail', 'refresh', 'remount'];
      const op = pick(ops);
      let label = op;
      if (op === 'id' || op === 'transition') {
        const v = 1 + Math.floor(random() * 3);
        label += ' ' + v;
        m.writeId(v, op === 'transition');
        if (op === 'id') id(v);
        else void startTransition(() => id(v));
      } else if (op === 'other') {
        const v = pick(['a', 'b', 'c']);
        label += ' ' + v;
        m.writeOther(v);
        other(v);
      } else if ((op === 'land' || op === 'fail') && inFlight.length > 0) {
        const [name, flight] = pick(inFlight);
        label += ' ' + name;
        flight.done = true;
        m.land(name, op === 'land');
        if (op === 'land') flight.resolve(name);
        else flight.reject(new Error('failed ' + name));
      } else if (op === 'refresh' && stop !== null) {
        m.refresh();
        void refresh(user).catch(() => {});
      } else if (op === 'remount') {
        if (stop !== null) {
          stop();
          stop = null;
          m.dispose();
          label = 'dispose';
        } else {
          doMount();
          label = 'mount';
        }
      } else {
        continue;
      }
      trace.push(label);
      await drain();
      await drain();
      const actual = read();
      const expected = m.view();
      if (JSON.stringify(actual) !== JSON.stringify(expected) || starts !== m.s.starts) {
        assert.fail(`seed ${seed}, after ${trace.join(' → ')}\nexpected ${JSON.stringify(expected)} (${m.s.starts} starts)\n` +
          `actual   ${JSON.stringify(actual)} (${starts} starts)`);
      }
    }
    // Every run that is not the current one was aborted.
    for (const [name, flight] of flights) {
      if (name !== m.s.current && !flight.done && !flight.abort.aborted) {
        assert.fail(`seed ${seed}: run ${name} was superseded but not aborted, after ${trace.join(' → ')}`);
      }
    }
  } finally {
    stop?.();
    for (const flight of flights.values()) flight.resolve('cleanup');
    await drain();
  }
  const quiet = await Promise.race([settled().then(() => true), drain().then(drain).then(() => false)]);
  assert.ok(quiet, `seed ${seed}: the graph did not go quiet after ${trace.join(' → ')}`);
}

it('random writes, transitions, landings, failures, refreshes and remounts match the model', async () => {
  const consoleError = console.error;
  console.error = () => {};
  const started = Date.now();
  let seeds = 0;
  try {
    for (let seed = 1; seed <= SEEDS; seed++) {
      await runSeed(seed);
      seeds++;
      if (seed >= 20 && Date.now() - started > BUDGET_MS) break;
    }
  } finally {
    console.error = consoleError;
  }
  assert.ok(seeds >= 20);
});
