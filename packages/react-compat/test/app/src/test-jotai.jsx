/**
 * Test: Jotai — primitive atomic state management
 * 2.7M weekly downloads. Hooks-based (useAtom), minimal API.
 */
import { atom, useAtom } from 'jotai';

const countAtom = atom(0);
const doubledAtom = atom((get) => get(countAtom) * 2);
const textAtom = atom('');
const uppercaseAtom = atom((get) => get(textAtom).toUpperCase());

function Counter() {
  const [count, setCount] = useAtom(countAtom);
  const [doubled] = useAtom(doubledAtom);

  return (
    <div style={{ marginBottom: '8px' }}>
      <p>Count: <strong>{count}</strong> (doubled: {doubled})</p>
      <button onclick={() => setCount(c => c + 1)} style={{ marginRight: '4px', padding: '4px 12px', borderRadius: '4px', border: '1px solid #ccc', cursor: 'pointer' }}>+</button>
      <button onclick={() => setCount(c => c - 1)} style={{ marginRight: '4px', padding: '4px 12px', borderRadius: '4px', border: '1px solid #ccc', cursor: 'pointer' }}>-</button>
      <button onclick={() => setCount(0)} style={{ padding: '4px 12px', borderRadius: '4px', border: '1px solid #ccc', cursor: 'pointer' }}>Reset</button>
    </div>
  );
}

function TextTransform() {
  const [text, setText] = useAtom(textAtom);
  const [upper] = useAtom(uppercaseAtom);

  return (
    <div>
      <input
        value={text}
        oninput={e => setText(e.target.value)}
        placeholder="Type something..."
        style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ccc', marginRight: '8px' }}
      />
      {upper && <span style={{ fontFamily: 'monospace', color: '#6366f1' }}>{upper}</span>}
    </div>
  );
}

export function JotaiTest() {
  return (
    <div>
      <Counter />
      <TextTransform />
      <p style={{ color: 'green' }} id="jotai-status">Jotai loaded OK</p>
    </div>
  );
}
