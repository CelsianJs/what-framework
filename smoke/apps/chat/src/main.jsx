// Relay: a busy chat room. Client-only; index.html ships an empty #app, and
// server.js serves it with the room's stream.

import './styles.css';

import { mount, useEffect, useState } from 'what-framework';

import { MAX_ROWS, connect, connected, keyOf, log, pending, readTo, received, send, stats, stuck, unseen } from './room.js';

// Whether an effect that follows the log saw the DOM already showing the
// newest message.
const probes = { effectRuns: 0, effectBeforeDom: 0 };
window.__chat.probes = probes;

const time = (ts) => (ts ? new Date(ts).toISOString().slice(11, 19) : '');

// A row reads its message only in its JSX. When the server's echo replaces a
// pending message under the same key, the row keeps its element and its
// bindings show the echo; a read in the component body (`const key =
// keyOf(m)`) would take the whole item and have the row built again.
function Message({ m }) {
  return (
    <li
      data-key={keyOf(m)}
      data-seq={m.seq ?? ''}
      class={m.pending ? 'msg pending' : m.author === 'you' ? 'msg mine' : 'msg'}
    >
      <b class="who">{m.author}</b>
      <span class="text">{m.text}</span>
      <time>{m.pending ? 'sending…' : time(m.ts)}</time>
    </li>
  );
}

function Log() {
  let box;
  let list;
  let scrollQueued = false;
  const rows = () => {
    const p = pending();
    return p.length ? [...log(), ...p] : log();
  };
  const toBottom = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      if (stuck.peek()) box.scrollTop = box.scrollHeight;
    });
  };
  // After each change of the log: the DOM already shows the newest row (a
  // passive effect runs after the update it follows), and the view follows
  // the bottom while the reader is there.
  useEffect(() => {
    const all = rows();
    probes.effectRuns++;
    const last = all[all.length - 1];
    if (last && list.lastElementChild?.dataset.key !== keyOf(last)) probes.effectBeforeDom++;
    if (stuck.peek()) toBottom();
  });
  const atBottom = () => box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
  return (
    <div class="log-wrap">
      <div
        class="log"
        data-scroller
        ref={(el) => { box = el; }}
        onWheel={(e) => { if (e.deltaY < 0 && stuck.peek()) readTo(false); }}
        onScroll={() => { if (!stuck.peek() && atBottom()) readTo(true); }}
      >
        <ol data-log ref={(el) => { list = el; }}>
          {rows().map((m) => <Message key={keyOf(m)} m={m} />)}
        </ol>
      </div>
      {unseen() > 0
        ? (
          <button class="unseen" data-unseen onClick={() => { readTo(true); box.scrollTop = box.scrollHeight; }}>
            {`${unseen()} new message${unseen() === 1 ? '' : 's'} ↓`}
          </button>
        )
        : null}
    </div>
  );
}

function Composer() {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const text = draft().trim();
    if (!text) return;
    setDraft('');
    send(text);
  };
  return (
    <form class="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea
        data-composer
        rows="2"
        aria-label="Message"
        placeholder={`Message #ops · ${received().toLocaleString('en-US')} messages`}
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div class="composer-side">
        <span class="muted" data-count>{`${draft().length}/500`}</span>
        <button type="submit" disabled={!draft().trim()}>Send</button>
      </div>
    </form>
  );
}

function Status() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <dl class="status" data-status>
      <div><dt>Stream</dt><dd data-connected class={connected() ? 'ok' : 'down'}>{connected() ? 'live' : 'reconnecting'}</dd></div>
      <div><dt>Messages</dt><dd data-received>{received().toLocaleString('en-US')}</dd></div>
      <div><dt>Kept</dt><dd data-kept>{`${log().length.toLocaleString('en-US')} / ${MAX_ROWS.toLocaleString('en-US')}`}</dd></div>
      <div><dt>Reconnects</dt><dd data-reconnects>{() => { now(); return stats.reconnects; }}</dd></div>
      <div><dt>Gaps · repeats</dt><dd data-health>{() => { now(); return `${stats.gaps} · ${stats.repeats}`; }}</dd></div>
    </dl>
  );
}

function App() {
  useEffect(() => connect(), []);
  return (
    <main class="page">
      <header class="masthead">
        <h1>Relay <span class="room">#ops</span></h1>
        <Status />
      </header>
      <Log />
      <Composer />
    </main>
  );
}

mount(<App />, '#app');
