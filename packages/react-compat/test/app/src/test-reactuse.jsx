import { useToggle, useCounter, useList, useCopyToClipboard, useWindowSize, useLocalStorage } from 'react-use';

export function ReactUseTest() {
  const [on, toggle] = useToggle(false);
  const [count, { inc, dec, reset }] = useCounter(0);
  const [list, { push, removeAt, clear }] = useList(['Apple', 'Banana']);
  const [clipState, copyToClipboard] = useCopyToClipboard();
  const { width, height } = useWindowSize();
  const [stored, setStored] = useLocalStorage('test-key', 'hello');

  return (
    <div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <div>
          <strong>useToggle:</strong>{' '}
          <button onclick={toggle}>{on ? 'ON' : 'OFF'}</button>
        </div>
        <div>
          <strong>useCounter:</strong>{' '}
          <button onclick={() => dec()}>-</button>
          <span style={{ margin: '0 6px' }}>{count}</span>
          <button onclick={() => inc()}>+</button>
          <button onclick={() => reset()} style={{ marginLeft: '4px' }}>reset</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <div>
          <strong>useList:</strong> [{list.join(', ')}]
          <button onclick={() => push('Cherry')} style={{ marginLeft: '4px' }}>+Cherry</button>
          {list.length > 0 && <button onclick={() => removeAt(0)} style={{ marginLeft: '4px' }}>-first</button>}
        </div>
        <div>
          <strong>useWindowSize:</strong> {width}x{height}
        </div>
      </div>
      <div style={{ marginBottom: '8px' }}>
        <strong>useCopyToClipboard:</strong>{' '}
        <button onclick={() => copyToClipboard('Hello from what-react!')}>Copy text</button>
        {clipState.value && <span style={{ marginLeft: '4px', color: '#22c55e' }}>Copied!</span>}
      </div>
      <p style={{ color: 'green' }}>react-use: 6 hooks (useToggle, useCounter, useList, useCopyToClipboard, useWindowSize, useLocalStorage)</p>
    </div>
  );
}
