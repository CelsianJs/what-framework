// ERR_CLEANUP_READS_LIVE: a useEffect cleanup that reads a prop or a state
// accessor its run also reads. A component runs once, so the cleanup reads it
// when it runs, after the change that made the effect run again, where
// React's cleanup sees the value of the render that made it (GOTCHAS.md,
// section 27). Reported at build time in development, and on the page.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';

let file = 0;
function compiled(source, options = {}) {
  const warn = console.warn;
  const seen = [];
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    const code = compileJSX(source, { filename: `/proj/src/cleanup-${file++}.jsx`, ...options });
    return { code, seen: seen.filter((w) => w.includes('ERR_CLEANUP_READS_LIVE')) };
  } finally {
    console.warn = warn;
  }
}
const warnings = (source) => compiled(source).seen;

const H = `import { useEffect, useState, useSignal } from 'what-framework';\n`;

describe('ERR_CLEANUP_READS_LIVE: reported', () => {
  for (const [shape, source, name] of [
    ['a destructured prop', `${H}export function ChatRoom({ roomId }) { useEffect(() => { join(roomId); return () => leave(roomId); }); return <h2>{roomId}</h2>; }`, 'roomId'],
    ['a prop read from props', `${H}export function ChatRoom(props) { useEffect(() => { join(props.roomId); return () => leave(props.roomId); }); return <h2 />; }`, 'props.roomId'],
    ['useState', `${H}export function ChatRoom() { const [room] = useState('a'); useEffect(() => { join(room()); return () => leave(room()); }); return <h2 />; }`, 'room()'],
    ['useSignal', `${H}export function ChatRoom() { const room = useSignal('a'); useEffect(() => { join(room()); return () => leave(room()); }); return <h2 />; }`, 'room()'],
    ['a dependency array of accessors', `${H}export function ChatRoom() { const [room] = useState('a'); useEffect(() => { join(room()); return () => leave(room()); }, [room]); return <h2 />; }`, 'room()'],
  ]) {
    it(`a cleanup reading ${shape} its run reads`, () => {
      const found = warnings(source);
      assert.equal(found.length, 1, found.join('\n'));
      assert.ok(found[0].includes(`reads \`${name}\``) && found[0].includes('which its run reads too'), found[0]);
    });
  }

  it('names the component, the hook and where the cleanup is, and says how to keep the value', () => {
    const [found] = warnings(`${H}export function ChatRoom({ roomId }) {
  useEffect(() => {
    join(roomId);
    return () => leave(roomId);
  });
  return <h2>{roomId}</h2>;
}`);
    assert.ok(found.includes('the useEffect cleanup in <ChatRoom>'), found);
    assert.match(found, /cleanup-\d+\.jsx:5:12/);
    assert.ok(found.includes('`const roomIdUsed = roomId;`'), found);
  });
});

describe('ERR_CLEANUP_READS_LIVE: not reported', () => {
  for (const [shape, source] of [
    ['the value kept in a local', `${H}export function ChatRoom({ roomId }) { useEffect(() => { const room = roomId; join(room); return () => leave(room); }); return <h2 />; }`],
    ['an effect that runs once ([])', `${H}export function ChatRoom({ roomId }) { useEffect(() => { join(roomId); return () => leave(roomId); }, []); return <h2 />; }`],
    ['a cleanup that reads what its run does not', `${H}export function Save({ draft, id }) { useEffect(() => { load(id); return () => save(draft); }); return <p />; }`],
    ['a read inside a function the cleanup writes', `${H}export function ChatRoom({ roomId }) { useEffect(() => { join(roomId); return () => setTimeout(() => leave(roomId)); }); return <h2 />; }`],
    ['an effect with no cleanup', `${H}export function ChatRoom({ roomId }) { useEffect(() => { join(roomId); }); return <h2 />; }`],
    ['useEffect from another library', `import { useEffect } from 'react';\nexport function ChatRoom({ roomId }) { useEffect(() => { join(roomId); return () => leave(roomId); }); return <h2 />; }`],
    ['a lower-case helper', `${H}export function useRoom({ roomId }) { useEffect(() => { join(roomId); return () => leave(roomId); }); }`],
  ]) {
    it(shape, () => {
      assert.deepEqual(warnings(source), []);
    });
  }

  it('a production build reports nothing and carries nothing for the page', () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { code, seen } = compiled(`${H}export function ChatRoom({ roomId }) { useEffect(() => { join(roomId); return () => leave(roomId); }); return <h2 />; }`, { production: true, pluginOptions: { devMetadata: true, projectRoot: '/proj' } });
      assert.deepEqual(seen, []);
      assert.doesNotMatch(code, /_\$buildDiagnostics/);
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});

describe('ERR_CLEANUP_READS_LIVE: on the page', () => {
  it('a development build reports it when the module loads', async () => {
    const { installDOM } = await import('../../../test-utils/dom.js');
    const { loadCompiled } = await import('../../../test-utils/load-compiled.js');
    const env = installDOM();
    try {
      const { clearDiagnostics, getDiagnostics } = await import('what-framework');
      clearDiagnostics();
      const warn = console.warn;
      console.warn = () => {};
      try {
        await loadCompiled(`${H}export function ChatRoom({ roomId }) { useEffect(() => { join(roomId); return () => leave(roomId); }); return <h2>{roomId}</h2>; }`,
          { filename: '/proj/src/Chat.jsx', pluginOptions: { devMetadata: true, projectRoot: '/proj' } });
      } finally {
        console.warn = warn;
      }
      const [event] = getDiagnostics().events.filter((e) => e.code === 'ERR_CLEANUP_READS_LIVE');
      assert.equal(event.loc, 'src/Chat.jsx:2:79');
      assert.equal(event.message, 'The useEffect cleanup in <ChatRoom> reads `roomId` when it runs, not the value its run used.');
    } finally {
      env.cleanup();
    }
  });
});
