// Harbor's quote server, as Connect middleware for Vite's dev and preview
// servers: the region lists, the email lookup, and the quote endpoint that
// validates a submission on the server. Each answer takes the time
// src/data.js gives it, so answers to quick requests arrive out of order.

import { EMAIL_DELAY, REGIONS, REGION_DELAY, TAKEN, judgeQuote } from './src/data.js';

const stats = { emailLookups: 0, regionLookups: 0, quotes: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function handle(req, res, next) {
  const url = new URL(req.url, 'http://harbor.local');
  if (!url.pathname.startsWith('/api/')) return next();

  if (url.pathname === '/api/regions') {
    const country = url.searchParams.get('country') || '';
    stats.regionLookups++;
    await sleep(REGION_DELAY[country] ?? 50);
    return send(res, 200, { country, regions: REGIONS[country] ?? [] });
  }

  if (url.pathname === '/api/email') {
    const address = (url.searchParams.get('address') || '').toLowerCase();
    stats.emailLookups++;
    const taken = TAKEN.includes(address);
    await sleep(taken ? EMAIL_DELAY.taken : EMAIL_DELAY.free);
    return send(res, 200, { address, available: !taken });
  }

  if (url.pathname === '/api/quote' && req.method === 'POST') {
    // The platform's own multipart parser, as a server framework would use.
    const form = await new Request('http://harbor.local/', {
      method: 'POST',
      headers: { 'content-type': req.headers['content-type'] },
      body: await body(req),
    }).formData();
    const draft = JSON.parse(String(form.get('draft') || '{}'));
    const license = form.get('license');
    const verdict = judgeQuote(draft, license instanceof File ? license : null);
    stats.quotes.push({ ok: verdict.ok, vehicles: draft.vehicles?.length, licenseBytes: license instanceof File ? license.size : 0 });
    await sleep(120);
    if (!verdict.ok) return send(res, 422, { errors: verdict.errors });
    return send(res, 200, { quoteId: `HQ-${1000 + stats.quotes.length}`, ...verdict });
  }

  if (url.pathname === '/api/stats') return send(res, 200, stats);
  if (url.pathname === '/api/stats/reset' && req.method === 'POST') {
    stats.emailLookups = 0;
    stats.regionLookups = 0;
    stats.quotes = [];
    return send(res, 200, stats);
  }
  return send(res, 404, { error: 'no such endpoint' });
}

export default function api() {
  return {
    name: 'harbor-api',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}
