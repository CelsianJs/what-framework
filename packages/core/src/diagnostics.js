// What Framework - Diagnostics channel
//
// One coded stream for everything the runtime notices in development: every
// check reports here, and devtools, the MCP bridge, what-framework/testing and
// the console all read from here. Messages and fixes come from ERROR_CODES, so
// what an agent reads over MCP, in a test failure and in the console is the
// same text.
//
// This module never reads the dev flag. Every call site is written as
// `if (__DEV__) report(...)`, so once __DEV__ is a build-time constant the
// call, this module and the catalogue it imports all drop out of production
// bundles. It also must not import reactive.js: the engine reports into this
// channel, and the import would be a cycle.
//
// Event shape (serializable; never holds a live node):
//   { seq, firstSeq, code, severity, message, fix, owner, loc, subject, data, count }
// owner    component/computation path, root first: ['<App>', '<TodoRow>', 'effect "sync"'].
//          A call site that does not pass one gets the scope the report was
//          made in, from the engine (see _setOwnerSource).
// loc      'src/TodoRow.jsx:18:3' when the compiler supplied one, else null.
// subject  { kind: 'signal'|'effect'|'component'|..., id?, name? } or null.
// count    repeats of the same code on the same subject, folded into one event.
//          A repeat moves the event to the newest seq, so a cursor read sees it,
//          and the event then describes that latest repeat: message, data,
//          owner and loc are the newest report's. firstSeq is the first one's.

import { getErrorDefinition } from './errors.js';

// Kept equal to packages/core/package.json by scripts/bump-version.mjs and
// checked by core/test/diagnostics.test.js. Pins the console docs link to the
// release the app is running, never to a branch.
export const VERSION = '0.14.0';

const SKILL_PATH = 'node_modules/what-framework/skills/what-diagnostics/SKILL.md';
const MAX_EVENTS = 500;

let seq = 0;
let dropped = 0;
// Insertion order is seq order: a repeat is deleted and re-inserted.
const events = new Map();
const listeners = new Set();
// Deliveries waiting for the listener loop. A listener that reports from inside
// its callback queues the new event behind the current one instead of
// delivering it first, so every listener sees events in seq order.
const pending = [];
let delivering = false;
const captures = new Set();
const pointed = new Set();

// Installed by the engine in development: the owner path of the scope running
// now, an array of strings with a `loc` property (reactive.js __ownerPath).
/** @type {(() => string[] & { loc: string | null }) | null} */
let ownerSource = null;

/** @internal The engine names the scope a report is made in. */
export function _setOwnerSource(fn) {
  ownerSource = fn;
}

function interpolate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (data[key] === undefined ? '(unknown)' : String(data[key])));
}

function docsUrl(code) {
  return `https://github.com/CelsianJs/what-framework/blob/v${VERSION}/docs/ERRORS.md#${code.toLowerCase().replace(/_/g, '-')}`;
}

function print(ev) {
  for (const c of captures) if (c.quiet) return;
  const lines = [`[what] ${ev.code} ${ev.message}`];
  if (ev.owner.length) lines.push(`  in ${ev.owner.join(' › ')}`);
  if (ev.loc) lines.push(`  at ${ev.loc}`);
  if (!pointed.has(ev.code)) {
    pointed.add(ev.code);
    lines.push(`  fix: what_fix({ error: "${ev.code}" }) · ${SKILL_PATH} · ${docsUrl(ev.code)}`);
  }
  if (typeof console === 'undefined') return;
  (ev.severity === 'error' ? console.error : console.warn)(lines.join('\n'));
}

/**
 * Report a diagnostic. `data` fills the catalogue template and travels with the
 * event; `owner` and `loc` come from the engine and compiler when they know them.
 * Returns the event, so a throwing site can reuse its message.
 * @param {string} code ERR_* code from ERROR_CODES
 * @param {{ data?: Record<string, any>, subject?: { kind: string, id?: any, name?: string } | null, owner?: string[], loc?: string | null }} [detail]
 */
export function report(code, detail = {}) {
  const known = getErrorDefinition(code);
  const def = known || getErrorDefinition('ERR_UNKNOWN');
  const data = known ? (detail.data || {}) : { ...detail.data, errorCode: code };
  const subject = detail.subject || null;
  const message = interpolate(def.template, data);
  const key = subject
    ? `${def.code}|${subject.kind}|${subject.id ?? subject.name}`
    : `${def.code}|${message}`;
  const where = ownerSource !== null && (detail.owner == null || detail.loc == null) ? ownerSource() : null;
  const owner = detail.owner || (where !== null ? [...where] : []);
  const loc = detail.loc || (where !== null ? where.loc : null);

  let ev = events.get(key);
  if (ev) {
    events.delete(key);
    ev.count++;
    ev.seq = ++seq;
    ev.message = message;
    ev.data = data;
    ev.owner = owner;
    ev.loc = loc;
    events.set(key, ev);
  } else {
    const at = ++seq;
    ev = {
      seq: at,
      firstSeq: at,
      code: def.code,
      severity: def.severity,
      message,
      fix: def.suggestion,
      owner,
      loc,
      subject,
      data,
      count: 1,
    };
    events.set(key, ev);
    if (events.size > MAX_EVENTS) {
      events.delete(events.keys().next().value);
      dropped++;
    }
    print(ev);
  }

  for (const c of captures) c.record(key, ev);
  deliver(ev);
  return ev;
}

function copy(ev) {
  return { ...ev, owner: [...ev.owner], subject: ev.subject && { ...ev.subject }, data: { ...ev.data } };
}

function deliver(ev) {
  if (listeners.size === 0) return;
  pending.push(Object.freeze(copy(ev)));
  if (delivering) return;
  delivering = true;
  try {
    for (let i = 0; i < pending.length; i++) {
      for (const fn of listeners) {
        try { fn(pending[i]); } catch { /* a broken listener must not break the app */ }
      }
    }
  } finally {
    pending.length = 0;
    delivering = false;
  }
}

/**
 * Listen to every report, repeats included, in seq order. Each delivery is a
 * frozen copy taken when the report was made. Returns an unsubscribe function.
 * @param {(event: any) => void} fn
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Collect the reports made from now until stop(), folded by code and subject
 * with counts local to this capture. `quiet: true` keeps them off the console
 * while the capture is open.
 * @param {{ quiet?: boolean }} [options]
 */
export function capture({ quiet = false } = {}) {
  const byKey = new Map();
  const collected = [];
  const sink = {
    quiet,
    record(key, ev) {
      const mine = byKey.get(key);
      if (mine) {
        Object.assign(mine, copy(ev), { firstSeq: mine.firstSeq, count: mine.count + 1 });
        return;
      }
      const own = { ...copy(ev), firstSeq: ev.seq, count: 1 };
      byKey.set(key, own);
      collected.push(own);
    },
  };
  captures.add(sink);
  return {
    events: collected,
    clear() {
      byKey.clear();
      collected.length = 0;
    },
    stop() {
      captures.delete(sink);
      return collected;
    },
  };
}

/**
 * Cursor read: events with a seq greater than `since`, oldest first. Pass the
 * returned `seq` back as `since` to read only what happened after this call.
 * `dropped` counts events evicted from the bounded buffer since startup.
 * @param {{ since?: number }} [options]
 */
export function getDiagnostics({ since = 0 } = {}) {
  const out = [];
  for (const ev of events.values()) if (ev.seq > since) out.push(copy(ev));
  return { events: out, seq, dropped };
}

/** Forget buffered events and console pointers. The sequence keeps counting. */
export function clearDiagnostics() {
  events.clear();
  pointed.clear();
  dropped = 0;
}

// Internal renderer annotations. Every caller is behind the development flag.

/** @type {{ name: string, binding: Node } | null} */
export let nextBinding = null;

// The renderer pairs this with its immediately following effect(() => …).
// The effect takes the annotation before the first run, so nesting is safe.
export function setNextBinding(binding, name) {
  nextBinding = { binding, name };
}

export function clearNextBinding() {
  nextBinding = null;
}

export function recordObservation(hooks, type, subject, state) {
  if (!hooks?.onRecord) return;
  try { hooks.onRecord(type, subject, state); }
  catch (error) {
    try { console.error('[what] devtools hook onRecord threw:', error); } catch { /* no console */ }
  }
}
