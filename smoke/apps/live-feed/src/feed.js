// A simulated market feed: what a WebSocket client library looks like from the
// app's side. `subscribe(fn)` hands every trade to `fn` and returns the
// unsubscribe; the feed runs on one interval timer and emits `rate` trades a
// second, spread over 10 ms ticks. Trades carry a sequence number, so a
// consumer can prove it saw each one exactly once.
//
// The feed knows nothing about What. `window.__feed` exposes its counters so
// the smoke check can compare what was sent with what the page shows.

export const SYMBOLS = ['ORBX', 'KELP', 'VNTA', 'QUIL', 'MOSS', 'TRVL', 'BRIK', 'FJRD'];
const START = { ORBX: 182.4, KELP: 23.05, VNTA: 91.7, QUIL: 7.42, MOSS: 310.1, TRVL: 48.9, BRIK: 64.3, FJRD: 129.6 };

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createFeed() {
  const listeners = new Set();
  const rand = mulberry32(7);
  const last = { ...START };
  let seq = 0;
  let rate = 120;
  let timer = null;
  let owed = 0;

  function emit() {
    owed += rate / 100;
    while (owed >= 1) {
      owed -= 1;
      const symbol = SYMBOLS[Math.floor(rand() * SYMBOLS.length)];
      const drift = (rand() - 0.5) * 0.004;
      const price = Math.max(0.01, Math.round(last[symbol] * (1 + drift) * 100) / 100);
      last[symbol] = price;
      const trade = {
        seq: ++seq,
        symbol,
        price,
        size: 1 + Math.floor(rand() * 400),
        side: rand() < 0.5 ? 'buy' : 'sell',
        at: Date.now(),
      };
      for (const fn of [...listeners]) fn(trade);
    }
  }

  const feed = {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start() {
      if (timer === null) timer = setInterval(emit, 10);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    get running() { return timer !== null; },
    get rate() { return rate; },
    setRate(n) { rate = n; },
    get emitted() { return seq; },
    get listeners() { return listeners.size; },
    start0: START,
  };
  return feed;
}

export const feed = createFeed();
if (typeof window !== 'undefined') window.__feed = feed;
