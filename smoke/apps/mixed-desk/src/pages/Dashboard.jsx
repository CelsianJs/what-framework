// Quotes from the store, three ways: a React island per symbol with the
// price as a prop, one React board of memo rows, and React components that
// read the signals while they render. A recharts line of the focused symbol,
// a React tape subscribed to the feed, and React state lifted into the store.

import { signal } from 'what-framework';
import { LineChart, Line, XAxis, YAxis } from 'recharts';

import { SYMBOLS, prices, history, lifted, lift, focus } from '../store.js';
import { Quote, Board } from '../react/Quote.jsx';
import { SignalQuote } from '../react/SignalQuote.jsx';
import { Lifter } from '../react/Lifter.jsx';
import { TradeTape } from '../react/TradeTape.jsx';

export const liftRunning = signal(false);

export function Dashboard() {
  return (
    <section data-route="dashboard">
      <h1>Dashboard <small data-focus>{focus()}</small></h1>
      <div class="quotes" data-quotes>
        {SYMBOLS.map((s) => <Quote key={s} symbol={s} price={prices[s]()} />)}
      </div>
      <Board rows={SYMBOLS.map((s) => ({ symbol: s, price: prices[s]() }))} />
      <p class="sigquotes">{SYMBOLS.map((s) => <SignalQuote key={s} symbol={s} />)}</p>
      <p class="native-prices">{SYMBOLS.map((s) => <span data-native-price={s}>{prices[s]()}</span>)}</p>
      <div class="chart" data-chart>
        <LineChart width={480} height={160} data={history()}>
          <XAxis dataKey="n" />
          <YAxis />
          <Line dataKey="price" isAnimationActive={false} dot={false} />
        </LineChart>
      </div>
      <TradeTape />
      <Lifter running={liftRunning()} rate={100} onLift={lift} echo={lifted()} />
      <p>Lifted into the store: <b data-lifted>{lifted()}</b></p>
      <button type="button" data-lift-toggle onClick={() => liftRunning(!liftRunning())}>{liftRunning() ? 'stop lifting' : 'start lifting'}</button>
    </section>
  );
}
