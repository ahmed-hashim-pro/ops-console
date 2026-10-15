// The event source and static file server. No dependencies.
//
//   GET /fleet?seed=&n=          the fleet's names, regions and kinds
//   GET /events?seed=&n=&rate=&from=   server-sent events, one SSE message per event
//   GET /zone/*                  the zone.js build of the same app (dist/ops-console-zone/browser)
//   GET /*                       the built app (dist/ops-console/browser)
//
// Each event goes out as its own SSE message, as most real event sources
// deliver them; how the client coalesces them is the point of the app.
// The server stamps the send time (ms since epoch) as the tuple's last
// element so the client can measure how stale what it shows is.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFleet, createStream } from './generator.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const defaultRoot = resolve(here, '..', 'dist', 'ops-console', 'browser');
// The zone.js build, for comparison runs (npm run build makes both).
const zoneRoot = resolve(here, '..', 'dist', 'ops-console-zone', 'browser');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

const LIMITS = { n: [1, 50000], rate: [0, 100000], seed: [0, 2 ** 31 - 1], from: [0, 1e9] };

function param(url, name, fallback) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  const v = Number(raw);
  const [lo, hi] = LIMITS[name];
  if (!Number.isInteger(v) || v < lo || v > hi) throw new RangeError(`${name} must be an integer from ${lo} to ${hi}`);
  return v;
}

export function startServer({ port = 8080, host = '127.0.0.1', root = defaultRoot, zone = zoneRoot, log = console.log } = {}) {
  const streams = new Set();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/fleet') {
        const fleet = createFleet(param(url, 'seed', 1), param(url, 'n', 5000));
        res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
        res.end(JSON.stringify(fleet));
        return;
      }
      if (url.pathname === '/events') {
        stream(req, res, param(url, 'seed', 1), param(url, 'n', 5000), param(url, 'rate', 1000), param(url, 'from', 0));
        return;
      }
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': TYPES['.txt'] });
        res.end('ok\n');
        return;
      }
      if (url.pathname === '/zone' || url.pathname.startsWith('/zone/')) await serveFile(url.pathname.slice(5), res, zone);
      else await serveFile(url.pathname, res, root);
    } catch (err) {
      const status = err instanceof RangeError ? 400 : 500;
      if (!res.headersSent) res.writeHead(status, { 'content-type': TYPES['.txt'] });
      res.end(`${err.message}\n`);
    }
  });

  async function serveFile(pathname, res, base) {
    const rel = normalize(decodeURIComponent(pathname || '/')).replace(/^([/\\])+/, '');
    let file = join(base, rel);
    if (!file.startsWith(base)) {
      res.writeHead(403).end();
      return;
    }
    let info = await stat(file).catch(() => null);
    // Unknown paths without an extension get the app (client-side state lives in the query string).
    if (!info || info.isDirectory()) {
      if (extname(rel) && !info) {
        res.writeHead(404, { 'content-type': TYPES['.txt'] }).end('not found\n');
        return;
      }
      file = join(base, 'index.html');
      info = await stat(file).catch(() => null);
      if (!info) {
        res.writeHead(503, { 'content-type': TYPES['.txt'] }).end('app not built: run `npm run build` first\n');
        return;
      }
    }
    const body = await readFile(file);
    const immutable = /-[A-Z0-9]{8}\.(js|css)$/.test(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  }

  // Sends `rate` events a second in 10 ms ticks. If the client can't keep
  // up, the socket buffer fills, write() returns false and the stream waits
  // for 'drain': events are delayed, never dropped, so a slow client shows
  // up as growing staleness on its side.
  // `from` resumes a stream after a reconnect: the generator is replayed to
  // that event so the client sees the sequence continue, not restart.
  function stream(req, res, seed, n, rate, from) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.socket?.setNoDelay(true);
    const gen = createStream(seed, n);
    for (let i = 0; i < from; i++) gen.next();
    res.write(`retry: 1000\nevent: hello\ndata: ${JSON.stringify({ seed, n, rate, from })}\n\n`);
    const state = { owed: 0, blocked: false, last: performance.now(), sent: 0 };
    streams.add(state);

    const timer = setInterval(() => {
      if (state.blocked) return;
      const now = performance.now();
      state.owed = Math.min(state.owed + ((now - state.last) / 1000) * rate, rate); // at most 1 s of catch-up
      state.last = now;
      const count = Math.floor(state.owed);
      if (count === 0) return;
      state.owed -= count;
      const ts = Date.now();
      let chunk = '';
      for (let i = 0; i < count; i++) {
        const ev = gen.next();
        ev.push(ts);
        chunk += `data: ${JSON.stringify(ev)}\n\n`;
      }
      state.sent += count;
      if (!res.write(chunk)) {
        state.blocked = true;
        res.once('drain', () => {
          state.blocked = false;
          state.last = performance.now();
          state.owed = 0;
        });
      }
    }, 10);

    req.on('close', () => {
      clearInterval(timer);
      streams.delete(state);
    });
  }

  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      log?.(`ops-console on http://${host}:${addr.port}`);
      resolveStart({
        port: addr.port,
        url: `http://${host}:${addr.port}`,
        stats: () => [...streams].map((s) => ({ sent: s.sent, blocked: s.blocked })),
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? '127.0.0.1';
  startServer({ port, host }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
