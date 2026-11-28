// react-window's row for the deals list: React code where it is written, so
// native code hands it to <List rowComponent>.
import { useProbe } from './probe.js';

export function DealRow({ index, style, deals }) {
  useProbe('deal-row');
  const d = deals[index];
  return (
    <div style={style} className="deal-row" data-deal-row={d.id}>
      <span>{d.name}</span> <span>{d.desk}</span> <b data-notional>{d.notional}</b> <i data-rev>r{d.rev}</i>
    </div>
  );
}
