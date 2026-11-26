// What the app keeps of the stream.
//
// The quote board is a store (one record per symbol, replaced on each trade);
// the tape and each symbol's price history are plain signals. Every trade is
// written the way a React app would setState per message: one store action and
// two signal writes, as it arrives.

import { createStore, derived, signal } from 'what-framework';

import { SYMBOLS, feed } from './feed.js';

const TAPE_LENGTH = 40;
export const HISTORY_LENGTH = 60;

export const useMarket = createStore({
  quotes: Object.fromEntries(SYMBOLS.map((s) => [s, {
    symbol: s, open: feed.start0[s], price: feed.start0[s], trades: 0, volume: 0,
  }])),
  received: 0,
  lastSeq: 0,
  gaps: 0,
  repeats: 0,
  buyVolume: 0,
  sellVolume: 0,

  leader: derived((s) => {
    let best = null;
    for (const q of Object.values(s.quotes)) {
      const change = (q.price - q.open) / q.open;
      if (!best || change > best.change) best = { symbol: q.symbol, change };
    }
    return best;
  }),

  apply(trade) {
    if (trade.seq <= this.lastSeq) { this.repeats = this.repeats + 1; return; }
    if (trade.seq !== this.lastSeq + 1) this.gaps = this.gaps + (trade.seq - this.lastSeq - 1);
    const q = this.quotes[trade.symbol];
    this.quotes = {
      ...this.quotes,
      [trade.symbol]: { ...q, price: trade.price, trades: q.trades + 1, volume: q.volume + trade.size },
    };
    this.received = this.received + 1;
    this.lastSeq = trade.seq;
    if (trade.side === 'buy') this.buyVolume = this.buyVolume + trade.size;
    else this.sellVolume = this.sellVolume + trade.size;
  },
});

export const tape = signal([]);
export const history = Object.fromEntries(SYMBOLS.map((s) => [s, signal([])]));

export function ingest(trade) {
  useMarket().apply(trade);
  tape((t) => [trade, ...t].slice(0, TAPE_LENGTH));
  history[trade.symbol]((h) => (h.length >= HISTORY_LENGTH ? [...h.slice(1), trade.price] : [...h, trade.price]));
}

// Counters the smoke check reads to prove cleanup: a panel's subscription, its
// timer, an effect or a binding that runs after the panel unmounted.
export const probes = { mounted: 0, unmounted: 0, lateCallbacks: 0, lateEffects: 0, lateBindings: 0 };
if (typeof window !== 'undefined') window.__probes = probes;
