// Memory over a long run: is the heap bounded?
//
//   node perf/soak.mjs [--minutes 10] [--rate 10000] [--n 5000] [--mode batched]
//                      [--out perf/soak.json] [--check]
//
// Every 30 s it forces a garbage collection (Chrome DevTools Protocol) and
// records the JS heap in use and the DOM node count. --check fails if, after
// the first two minutes (warm-up: caches, history buffers and the alert feed
// fill up to their caps), the heap grows by more than 10% or 2 MB, whichever
// is larger, or the DOM node count by more than 10%.

import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { startServer } from '../server/server.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]);
    return acc;
  }, []),
);
const minutes = Number(args.minutes ?? 10);
const rate = Number(args.rate ?? 10000);
const n = Number(args.n ?? 5000);
const mode = args.mode ?? 'batched';
const out = args.out ?? 'perf/soak.json';
const EVERY = 30_000;

const srv = await startServer({ port: 0, log: null });
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
const path = mode === 'zone' ? '/zone/?' : `/?mode=${mode}&`;
await page.goto(`${srv.url}${path}perf&rate=${rate}&n=${n}`);
await page.getByTestId('connection').filter({ hasText: 'Live' }).waitFor();
// Open details so the charts and the detail panel are part of what runs.
await page.locator('.fleet tbody button.open').first().click();

const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < minutes * 60_000 + 1000) {
  await page.waitForTimeout(Math.max(0, EVERY - ((Date.now() - t0) % EVERY)));
  // The perf hooks keep every frame time; empty them so they don't count as the app's memory.
  await page.evaluate(() => window.__perf.reset());
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  const { nodes } = await cdp.send('Memory.getDOMCounters');
  const received = await page.evaluate(() => window.__perf.received());
  const s = { at: Math.round((Date.now() - t0) / 1000), heapMB: usedSize / 2 ** 20, domNodes: nodes, received };
  samples.push(s);
  console.log(`${String(s.at).padStart(4)} s  heap ${s.heapMB.toFixed(2)} MB  DOM nodes ${nodes}  events ${received.toLocaleString()}`);
}
await browser.close();
await srv.close();

const warm = samples.filter((s) => s.at >= 120);
const base = warm[0];
const peak = warm.reduce((m, s) => (s.heapMB > m.heapMB ? s : m), base);
const domPeak = Math.max(...warm.map((s) => s.domNodes));
const result = {
  env: { date: new Date().toISOString(), load: loadavg()[0], minutes, rate, n, mode },
  samples,
  afterWarmup: {
    heapStartMB: base.heapMB,
    heapPeakMB: peak.heapMB,
    heapEndMB: warm.at(-1).heapMB,
    growthMB: peak.heapMB - base.heapMB,
    domStart: base.domNodes,
    domPeak,
  },
};
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
const a = result.afterWarmup;
console.log(
  `after warm-up: heap ${a.heapStartMB.toFixed(2)} → peak ${a.heapPeakMB.toFixed(2)} → end ${a.heapEndMB.toFixed(2)} MB; DOM nodes ${a.domStart} → peak ${a.domPeak}`,
);
if (args.check) {
  const allowed = Math.max(2, a.heapStartMB * 0.1);
  const fails = [];
  if (a.growthMB > allowed) fails.push(`heap grew ${a.growthMB.toFixed(2)} MB > ${allowed.toFixed(2)} MB`);
  if (a.domPeak > a.domStart * 1.1) fails.push(`DOM nodes grew ${a.domStart} → ${a.domPeak}`);
  if (fails.length) {
    console.error('soak check failed: ' + fails.join('; '));
    process.exit(1);
  }
  console.log('soak check passed');
}
