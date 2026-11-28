// The room as the client keeps it: the last MAX_ROWS messages, the messages
// this client sent that the server has not echoed yet, and the stream's
// health. Each message is written into signals as it arrives, the way a
// React app calls setState per message.
//
// The log is ordered by sequence number. A message this client posts shows
// at once at the bottom (pending, keyed by its client id); when the server
// echoes it, the echo takes the pending row's place under the same key, in
// sequence order. Sequence numbers make loss and repeats exact: a number
// already seen is a repeat (dropped and counted), a jump is a gap.

import { batch, signal } from 'what-framework';

export const MAX_ROWS = 1000;

export const log = signal([], 'log');
export const pending = signal([], 'pending');
export const connected = signal(false, 'connected');
export const received = signal(0, 'received');
export const stuck = signal(true, 'stuck');
export const unseen = signal(0, 'unseen');

export const stats = { lastSeq: 0, gaps: 0, repeats: 0, reconnects: 0, opens: 0, errors: 0, echoes: 0 };
if (typeof window !== 'undefined') window.__chat = { stats };

const keyOf = (m) => m.cid ?? `s${m.seq}`;
export { keyOf };

function ingest(m) {
  if (m.seq <= stats.lastSeq) { stats.repeats++; return; }
  if (m.seq !== stats.lastSeq + 1 && stats.lastSeq !== 0) stats.gaps += m.seq - stats.lastSeq - 1;
  stats.lastSeq = m.seq;
  batch(() => {
    received((n) => n + 1);
    if (m.cid && pending.peek().some((p) => p.cid === m.cid)) {
      stats.echoes++;
      pending((p) => p.filter((x) => x.cid !== m.cid));
    }
    // While the reader is scrolled up, nothing is trimmed from the top, so
    // what they are reading stays where it is; back at the bottom the cap
    // applies again.
    log((l) => {
      const next = l.length >= MAX_ROWS && stuck.peek() ? l.slice(l.length - MAX_ROWS + 1) : l.slice();
      next.push(m);
      return next;
    });
    if (!stuck.peek()) unseen((n) => n + 1);
  });
}

let source = null;
export function connect() {
  source = new EventSource('/events');
  source.onopen = () => {
    stats.opens++;
    if (stats.opens > 1) stats.reconnects++;
    connected(true);
  };
  source.onerror = () => {
    stats.errors++;
    connected(false);
  };
  source.onmessage = (e) => ingest(JSON.parse(e.data));
  return () => source.close();
}

export function readTo(bottom) {
  batch(() => {
    stuck(bottom);
    if (bottom) {
      unseen(0);
      log((l) => (l.length > MAX_ROWS ? l.slice(l.length - MAX_ROWS) : l));
    }
  });
}

let cids = 0;
export async function send(text) {
  const cid = `c${Date.now().toString(36)}-${++cids}`;
  pending((p) => [...p, { cid, author: 'you', text, pending: true }]);
  const res = await fetch('/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid, text, author: 'you' }) });
  if (!res.ok) pending((p) => p.map((x) => (x.cid === cid ? { ...x, failed: true } : x)));
  return cid;
}
