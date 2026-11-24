import { useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Item } from './parts.jsx';

export default function Fixture() {
  const ref = useRef(null);
  const [picked, setPicked] = useState(-1);
  const [count, setCount] = useState(2000);
  const [range, setRange] = useState('');
  return (
    <div>
      <button id="rv-jump" onClick={() => ref.current.scrollToIndex({ index: 1500, align: 'start' })}>jump</button>
      <button id="rv-more" onClick={() => setCount(count + 1000)}>more</button>
      <button id="rv-end" onClick={() => ref.current.scrollToIndex({ index: count - 1, align: 'end' })}>end</button>
      <span id="rv-picked">{picked}</span>
      <span id="rv-range">{range}</span>
      <span id="rv-count">{count}</span>
      <Virtuoso
        id="rv-list"
        ref={ref}
        style={{ height: 300, width: 300 }}
        totalCount={count}
        rangeChanged={(r) => setRange(`${r.startIndex}-${r.endIndex}`)}
        itemContent={(index) => <Item index={index} onPick={setPicked} />}
      />
    </div>
  );
}
