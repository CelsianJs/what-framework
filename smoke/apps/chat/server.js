// Relay: the chat room's own server. It serves the built client from dist/
// and the room as a server-sent-event stream, and it is unreliable on
// purpose: it closes every stream after a while, sometimes cleanly and
// sometimes by destroying the socket halfway through writing an event.
//
// Every message gets the next sequence number and is the stream's event id,
// so a client that reconnects (EventSource sends Last-Event-ID by itself)
// is replayed exactly what it has not seen. A message the client posts
// comes back on the stream carrying the client's own id (`cid`).
//
//   PORT=4800 node server.js
//   PORT=4800 node server.js --dev   # the client from the source, through Vite
//
// Control (what the smoke check drives):
//   POST /__control {"rate":400,"burst":300,"burstEvery":1500,"drop":[600,1600],"running":true}
//   POST /__drop     close every open stream now, mid-event
//   POST /__burst {"n":400}  that many messages at once, now
//   GET  /__stats    { emitted, connections, opened, drops, posted }

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('./dist/', import.meta.url));
const PORT = Number(process.env.PORT) || 4800;
const DEV = process.argv.includes('--dev');
const LOG_CAP = 100_000;

const AUTHORS = ['ada', 'grace', 'linus', 'margaret', 'ken', 'barbara', 'dennis', 'frances', 'edsger', 'radia'];
const WORDS = ['deploy', 'green', 'flaky', 'rollback', 'merged', 'latency', 'p99', 'cache', 'shipping', 'review', 'pager', 'canary', 'hotfix', 'standup', 'lunch', 'ticket', 'retro', 'build', 'regression', 'fixed'];

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);

const config = { rate: 40, burst: 0, burstEvery: 4000, drop: [4000, 9000], running: true };
const log = [];          // the room, oldest first: { seq, author, text, ts, cid? }
let firstSeq = 1;        // seq of log[0] once the cap trims it
let seq = 0;
const streams = new Set();
const stats = { emitted: 0, connections: 0, opened: 0, drops: 0, posted: 0 };

function frame(m) {
  return `id: ${m.seq}\ndata: ${JSON.stringify(m)}\n\n`;
}

function append(m) {
  m.seq = ++seq;
  m.ts = Date.now();
  log.push(m);
  if (log.length > LOG_CAP) { log.shift(); firstSeq++; }
  stats.emitted = seq;
  for (const s of streams) s.res.write(frame(m));
}

function chatter() {
  const words = 3 + Math.floor(rand() * 9);
  let text = '';
  for (let i = 0; i < words; i++) text += (i ? ' ' : '') + WORDS[Math.floor(rand() * WORDS.length)];
  append({ author: AUTHORS[Math.floor(rand() * AUTHORS.length)], text });
}

// The room talks at `rate` messages a second, in 10 ms ticks, plus a burst of
// `burst` messages at once every `burstEvery` ms.
let owed = 0;
let lastBurst = Date.now();
setInterval(() => {
  if (!config.running) return;
  owed += config.rate / 100;
  for (; owed >= 1; owed--) chatter();
  if (config.burst > 0 && Date.now() - lastBurst >= config.burstEvery) {
    lastBurst = Date.now();
    for (let i = 0; i < config.burst; i++) chatter();
  }
}, 10).unref();

function dropLater(s) {
  const [lo, hi] = config.drop;
  s.timer = setTimeout(() => drop(s, rand() < 0.5), lo + rand() * (hi - lo));
}

// Close one stream: cleanly, or by writing half of the next event and
// destroying the socket, the way a proxy or a dead network ends one.
function drop(s, abrupt) {
  if (!streams.has(s)) return;
  streams.delete(s);
  clearTimeout(s.timer);
  stats.drops++;
  if (abrupt) {
    s.res.write(`id: ${seq + 1}\ndata: {"seq":${seq + 1},"author":"cut`);
    s.res.socket?.destroy();
  } else {
    s.res.end();
  }
}

function openStream(req, res) {
  const url = new URL(req.url, 'http://x');
  const after = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0) || 0;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.socket.setNoDelay(true);
  // Reconnect quickly, and replay what this client has not seen.
  let out = 'retry: 150\n\n';
  for (let i = Math.max(0, after + 1 - firstSeq); i < log.length; i++) out += frame(log[i]);
  res.write(out);
  const s = { res, timer: null };
  streams.add(s);
  stats.connections = streams.size;
  stats.opened++;
  dropLater(s);
  const gone = () => {
    streams.delete(s);
    clearTimeout(s.timer);
    stats.connections = streams.size;
  };
  req.on('close', gone);
  res.on('error', gone);
}

function body(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serveStatic(req, res) {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) { res.writeHead(503, { 'content-type': 'text/plain' }).end('run `npm run build` first'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const json = (res, value, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));

// In development Vite serves the client (index.html and its modules) from the
// source, its HMR socket on this server's port.
let vite = null;

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/events') return openStream(req, res);
  if (pathname === '/send' && req.method === 'POST') {
    const { cid, text, author } = await body(req);
    if (typeof cid !== 'string' || typeof text !== 'string' || !text.trim()) return json(res, { error: 'cid and text required' }, 400);
    stats.posted++;
    const m = { author: String(author || 'you').slice(0, 24), text: text.slice(0, 500), cid };
    append(m);
    return json(res, { seq: m.seq });
  }
  if (pathname === '/__control' && req.method === 'POST') {
    Object.assign(config, await body(req));
    lastBurst = Date.now();
    return json(res, config);
  }
  if (pathname === '/__burst' && req.method === 'POST') {
    const { n = 100 } = await body(req);
    for (let i = 0; i < Math.min(5000, n); i++) chatter();
    return json(res, { emitted: seq });
  }
  if (pathname === '/__drop' && req.method === 'POST') {
    const n = streams.size;
    for (const s of [...streams]) drop(s, true);
    return json(res, { dropped: n });
  }
  if (pathname === '/__stats') return json(res, { ...stats, connections: streams.size });
  if (vite) vite.middlewares(req, res, () => res.writeHead(404).end());
  else serveStatic(req, res);
});

if (DEV) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({ root: fileURLToPath(new URL('.', import.meta.url)), server: { middlewareMode: true, hmr: { server, port: PORT } } });
}
server.listen(PORT, '127.0.0.1', () => console.log(`relay on http://127.0.0.1:${PORT}${DEV ? ' (development)' : ''}`));
