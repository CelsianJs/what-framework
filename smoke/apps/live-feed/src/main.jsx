// Tidewater: a live trading tape. Client-only; index.html ships an empty #app.

import './styles.css';

import { mount, onCleanup, useEffect, useMemo, useState } from 'what-framework';

import { SYMBOLS, feed } from './feed.js';
import { HISTORY_LENGTH, history, ingest, probes, tape, useMarket } from './market.js';

const W = 160;
const H = 40;

function Sparkline({ values }) {
  const points = useMemo(() => {
    const v = values();
    if (v.length < 2) return '';
    let min = Infinity;
    let max = -Infinity;
    for (const p of v) { if (p < min) min = p; if (p > max) max = p; }
    const span = max - min || 1;
    return v.map((p, i) => `${((i / (HISTORY_LENGTH - 1)) * W).toFixed(1)},${(H - 2 - ((p - min) / span) * (H - 4)).toFixed(1)}`).join(' ');
  });
  return (
    <svg class="spark" viewBox={`0 0 ${W} ${H}`} data-spark aria-hidden="true">
      <polyline points={points()} fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  );
}

function TickerCard({ symbol }) {
  const market = useMarket();
  const quote = () => market.quotes[symbol];
  const change = () => ((quote().price - quote().open) / quote().open) * 100;
  return (
    <article class={change() >= 0 ? 'card up' : 'card down'} data-ticker={symbol}>
      <header>
        <b>{symbol}</b>
        <span class="price" data-price>{quote().price.toFixed(2)}</span>
      </header>
      <span class="change" data-change>{`${change() >= 0 ? '+' : ''}${change().toFixed(2)}%`}</span>
      <Sparkline values={history[symbol]} />
      <footer data-trades>{`${quote().trades} trades · ${quote().volume.toLocaleString('en-US')} sh`}</footer>
    </article>
  );
}

function Tape() {
  return (
    <ol class="tape" data-tape>
      {tape().map((t) => (
        <li key={t.seq} data-seq={t.seq} class={t.side}>
          <span class="seq">#{t.seq}</span>
          <b>{t.symbol}</b>
          <span>{t.side}</span>
          <span class="num">{t.size}</span>
          <span class="num">{t.price.toFixed(2)}</span>
        </li>
      ))}
    </ol>
  );
}

// A panel with its own subscription and its own timer, both released when it
// unmounts. The counters in `probes` catch anything that reaches it after.
function WatchPanel({ symbol }) {
  const market = useMarket();
  const [recent, setRecent] = useState([]);
  const [seconds, setSeconds] = useState(0);
  let gone = false;
  onCleanup(() => { gone = true; });

  useEffect(() => {
    probes.mounted++;
    const off = feed.subscribe((t) => {
      if (gone) probes.lateCallbacks++;
      if (t.symbol === symbol) setRecent((r) => [t, ...r].slice(0, 6));
    });
    const timer = setInterval(() => {
      if (gone) probes.lateCallbacks++;
      setSeconds((s) => s + 1);
    }, 1000);
    return () => {
      probes.unmounted++;
      off();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    // Re-runs on every trade of this symbol.
    const price = market.quotes[symbol].price;
    if (gone) probes.lateEffects++;
    document.title = `${symbol} ${price.toFixed(2)} · Tidewater`;
  });

  const vwap = useMemo(() => {
    const r = recent();
    let notional = 0;
    let size = 0;
    for (const t of r) { notional += t.price * t.size; size += t.size; }
    return size ? notional / size : 0;
  });

  return (
    <section class="panel" data-panel={symbol}>
      <h3>{symbol} <span class="muted">watching {seconds()}s</span></h3>
      <p data-vwap>VWAP (last {recent().length}) {vwap().toFixed(2)}</p>
      <p class="muted">
        {() => {
          if (gone) probes.lateBindings++;
          return `last ${market.quotes[symbol].price.toFixed(2)}`;
        }}
      </p>
    </section>
  );
}

function Controls({ running, setRunning }) {
  const toggle = () => {
    if (feed.running) feed.stop(); else feed.start();
    setRunning(feed.running);
  };
  return (
    <div class="controls">
      <button data-pause onClick={toggle}>{running() ? 'Pause' : 'Resume'}</button>
      <label>
        Rate{' '}
        <select data-rate onChange={(e) => feed.setRate(Number(e.currentTarget.value))}>
          {[50, 100, 120, 150, 200].map((n) => <option value={n} selected={n === feed.rate}>{n}/s</option>)}
        </select>
      </label>
    </div>
  );
}

function Counters() {
  const market = useMarket();
  const [perSecond, setPerSecond] = useState(0);
  useEffect(() => {
    let last = market.received;
    const timer = setInterval(() => {
      setPerSecond(market.received - last);
      last = market.received;
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const buyShare = () => {
    const total = market.buyVolume + market.sellVolume;
    return total ? Math.round((market.buyVolume / total) * 100) : 50;
  };
  return (
    <dl class="counters">
      <div><dt>Trades</dt><dd data-received>{() => market.received}</dd></div>
      <div><dt>Per second</dt><dd data-rate-seen>{perSecond()}</dd></div>
      <div><dt>Buy share</dt><dd data-buy-share>{() => `${buyShare()}%`}</dd></div>
      <div><dt>Leader</dt><dd data-leader>{() => market.leader?.symbol}</dd></div>
      <div><dt>Gaps</dt><dd data-gaps>{() => market.gaps}</dd></div>
      <div><dt>Repeats</dt><dd data-repeats>{() => market.repeats}</dd></div>
    </dl>
  );
}

function App() {
  const [running, setRunning] = useState(false);
  const [watching, setWatching] = useState([]);

  useEffect(() => {
    const off = feed.subscribe(ingest);
    feed.start();
    setRunning(true);
    return () => { off(); feed.stop(); };
  }, []);

  const toggleWatch = (symbol) => setWatching((w) => (w.includes(symbol) ? w.filter((s) => s !== symbol) : [...w, symbol]));

  return (
    <main class="page">
      <header class="masthead">
        <h1>Tidewater</h1>
        <Controls running={running} setRunning={setRunning} />
      </header>
      <Counters />
      <section class="board">
        {SYMBOLS.map((s) => <TickerCard symbol={s} />)}
      </section>
      <div class="lower">
        <div>
          <h2>Tape</h2>
          <Tape />
        </div>
        <div>
          <h2>Watch</h2>
          <div class="watch-toggles">
            {SYMBOLS.map((s) => (
              <label>
                <input type="checkbox" data-watch={s} checked={watching().includes(s)} onChange={() => toggleWatch(s)} />
                {s}
              </label>
            ))}
          </div>
          {watching().map((s) => <WatchPanel key={s} symbol={s} />)}
        </div>
      </div>
    </main>
  );
}

mount(<App />, '#app');
