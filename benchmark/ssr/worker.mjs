#!/usr/bin/env node
// One measurement job in a fresh Node process, spawned by bench.mjs: one
// bundle, one operation, one row count. Prints one JSON object on stdout.
//
// Every job first renders once and asserts the output (shared/verify.mjs);
// a framework that renders the wrong thing fails the job instead of timing it.
//
//   string       renderString() + Buffer.from() of its result, timed one call
//                at a time after warmup. The encode is inside the timed region
//                because Solid and React return V8 ropes (lazily concatenated
//                strings) whose flattening cost is otherwise paid later, when
//                the bytes hit the socket. Render-only time is kept too.
//   stream       stream() of the plain page into a recording Writable: time to
//                first chunk and to 'finish'.
//   streamAsync  streamAsync(): the table sits in one Suspense/Loading boundary
//                whose data resolves after delayMs. Also records when the shell
//                end marker (the <footer> after the boundary) went out, whether
//                the fallback was flushed before the data, and the bytes sent
//                before the data resolved.
//   memory       heap bytes allocated by one renderString() call: gc() twice,
//                read heapUsed, render, read heapUsed while the result is
//                alive. Needs --expose-gc and a young generation big enough
//                that no GC runs mid-render (bench.mjs passes
//                --max-semi-space-size); a sample during which any GC ran is
//                discarded, never estimated.

import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { PerformanceObserver } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRows, expectedPageHtml, SELECTED_ID, FALLBACK_TEXT, SHELL_END_TEXT } from './shared/data.mjs';
import { verifyPage, verifyAsyncPage } from './shared/verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const job = JSON.parse(process.argv[2]);
const mod = await import(pathToFileURL(path.join(here, 'dist', `${job.bundle}.mjs`)).href);
const rows = buildRows(job.rows);

function recordingSink(t0, resolvedAt) {
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const t = performance.now() - t0;
      if (sink.firstChunkMs === null) sink.firstChunkMs = t;
      if (sink.shellEndMs === null && (sink.tail + text).includes(SHELL_END_TEXT)) sink.shellEndMs = t;
      if (!sink.fallbackSent && resolvedAt.ms === null && (sink.tail + text).includes(FALLBACK_TEXT)) sink.fallbackSent = true;
      if (resolvedAt.ms === null) sink.bytesBeforeResolve += Buffer.byteLength(text);
      sink.bytes += Buffer.byteLength(text);
      sink.chunks++;
      sink.tail = text.slice(-SHELL_END_TEXT.length);
      if (sink.keep) sink.parts.push(text);
      callback();
    },
  });
  Object.assign(sink, { firstChunkMs: null, shellEndMs: null, fallbackSent: false, bytesBeforeResolve: 0, bytes: 0, chunks: 0, tail: '', keep: false, parts: [] });
  return sink;
}

async function streamOnce(keep) {
  const resolvedAt = { ms: null };
  const t0 = performance.now();
  const sink = recordingSink(t0, resolvedAt);
  sink.keep = keep;
  if (job.op === 'stream') {
    mod.stream(rows, SELECTED_ID, sink);
  } else {
    const data = new Promise((resolve) => setTimeout(() => {
      resolvedAt.ms = performance.now() - t0;
      resolve(rows);
    }, job.delayMs));
    mod.streamAsync(SELECTED_ID, () => data, sink);
  }
  await finished(sink);
  return {
    firstChunkMs: sink.firstChunkMs,
    shellEndMs: sink.shellEndMs,
    doneMs: performance.now() - t0,
    resolvedMs: resolvedAt.ms,
    fallbackSent: sink.fallbackSent,
    bytesBeforeResolve: sink.bytesBeforeResolve,
    bytes: sink.bytes,
    chunks: sink.chunks,
    html: keep ? sink.parts.join('') : null,
  };
}

async function measureStream() {
  const first = await streamOnce(true);
  if (job.op === 'stream') verifyPage(first.html, rows, SELECTED_ID, expectedPageHtml(rows, SELECTED_ID));
  else verifyAsyncPage(first.html, rows, SELECTED_ID, SHELL_END_TEXT);
  for (let i = 0; i < job.warmup; i++) await streamOnce(false);
  const samples = [];
  for (let i = 0; i < job.samples; i++) {
    const { html, ...sample } = await streamOnce(false);
    samples.push(sample);
  }
  return { bytes: first.bytes, chunks: first.chunks, samples };
}

function measureString() {
  const html = mod.renderString(rows, SELECTED_ID);
  verifyPage(html, rows, SELECTED_ID, expectedPageHtml(rows, SELECTED_ID));
  for (let i = 0; i < job.warmup; i++) Buffer.from(mod.renderString(rows, SELECTED_ID));
  const samples = new Array(job.samples);
  const renderOnly = new Array(job.samples);
  for (let i = 0; i < job.samples; i++) {
    const t0 = performance.now();
    const out = mod.renderString(rows, SELECTED_ID);
    const t1 = performance.now();
    Buffer.from(out);
    samples[i] = performance.now() - t0;
    renderOnly[i] = t1 - t0;
  }
  return { bytes: Buffer.byteLength(html), samples, renderOnly };
}

async function measureMemory() {
  if (typeof globalThis.gc !== 'function') throw new Error('memory job needs --expose-gc');
  const html = mod.renderString(rows, SELECTED_ID);
  verifyPage(html, rows, SELECTED_ID, expectedPageHtml(rows, SELECTED_ID));
  for (let i = 0; i < job.warmup; i++) mod.renderString(rows, SELECTED_ID);

  const gcTimes = [];
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) gcTimes.push([e.startTime, e.startTime + e.duration]);
  });
  observer.observe({ entryTypes: ['gc'] });

  const windows = [];
  const deltas = [];
  for (let i = 0; i < job.samples; i++) {
    globalThis.gc();
    globalThis.gc();
    await new Promise((resolve) => setImmediate(resolve));
    const before = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const out = mod.renderString(rows, SELECTED_ID);
    const t1 = performance.now();
    const after = process.memoryUsage().heapUsed;
    if (out.length !== html.length) throw new Error('render output changed between samples');
    windows.push([t0, t1]);
    deltas.push(after - before);
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  observer.disconnect();

  const valid = deltas.filter((_, i) => !gcTimes.some(([s, e]) => s < windows[i][1] && e > windows[i][0]));
  return { bytes: Buffer.byteLength(html), samples: valid, discarded: deltas.length - valid.length };
}

const MEASURE = { string: measureString, stream: measureStream, streamAsync: measureStream, memory: measureMemory };

try {
  const result = await MEASURE[job.op]();
  process.stdout.write(JSON.stringify({ ok: true, ...result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error && error.stack || error) }));
  process.exitCode = 1;
}
