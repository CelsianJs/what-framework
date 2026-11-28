// A quote tile. Native code renders one per symbol as its own island, with
// the price as a prop from the store.
import { memo } from 'react';
import { useProbe } from './probe.js';

export function Quote({ symbol, price }) {
  useProbe(`quote:${symbol}`);
  return (
    <div className="quote" data-quote={symbol}>
      <span className="sym">{symbol}</span>
      <b data-price>{price}</b>
    </div>
  );
}

// The same tile inside one React board: memo keeps the rows whose price did
// not change from rendering.
const BoardRow = memo(function BoardRow({ symbol, price }) {
  useProbe(`board:${symbol}`);
  return <li data-board-row={symbol}>{symbol} <b>{price}</b></li>;
});

export function Board({ rows }) {
  useProbe('board');
  return <ul className="board" data-board>{rows.map((r) => <BoardRow key={r.symbol} symbol={r.symbol} price={r.price} />)}</ul>;
}
