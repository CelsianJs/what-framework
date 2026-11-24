// fixture.jsx as a native What file: signals for state, <Virtuoso> is an island.
import { signal } from 'what-framework';
import { Virtuoso } from 'react-virtuoso';

export default function Native() {
  const ref = { current: null };
  const picked = signal(-1);
  const count = signal(2000);
  const range = signal('');
  return (
    <div>
      <button id="rv-jump" onClick={() => ref.current.scrollToIndex({ index: 1500, align: 'start' })}>jump</button>
      <button id="rv-more" onClick={() => count(count() + 1000)}>more</button>
      <button id="rv-end" onClick={() => ref.current.scrollToIndex({ index: count() - 1, align: 'end' })}>end</button>
      <span id="rv-picked">{picked()}</span>
      <span id="rv-range">{range()}</span>
      <span id="rv-count">{count()}</span>
      <Virtuoso
        id="rv-list"
        ref={ref}
        style={{ height: 300, width: 300 }}
        totalCount={count()}
        rangeChanged={(r) => range(`${r.startIndex}-${r.endIndex}`)}
        itemContent={(index) => (
          <div className="rv-row" data-index={index} style={{ height: index % 3 === 0 ? 40 : 24 }} onClick={() => picked(index)}>
            Item {index}
          </div>
        )}
      />
    </div>
  );
}
