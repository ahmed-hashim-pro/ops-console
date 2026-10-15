// Frame, input and freshness measurements of the real app in Chromium.
//
//   node perf/run.mjs [--modes batched,eager,naive,zone] [--rates 2000,10000] [--n 5000]
//                     [--seconds 20] [--warmup 5] [--out perf/results.json]
//                     [--throttle 4]  (Chrome's CPU throttling: 4 = DevTools' "4x slowdown")
//                     [--check]   (exit 1 if the batched store misses the thresholds below)
//
// For each mode and rate it opens a fresh page, lets the stream run for the
// warm-up, then measures for `seconds` while a "user" types into the search
// box every 500 ms (a character, then Backspace). Everything is recorded in
// the page (src/app/perf.ts): every frame interval, long tasks, the delay
// from each keydown to the next frame, and the age of the data at each
// publish. Needs a build (npm run build) and Playwright's Chromium.

import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { loadavg, cpus } from 'node:os';
import { startServer } from '../server/server.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]);
    return acc;
  }, []),
);
const modes = (args.modes ?? 'batched,eager,naive,zone').split(',');
const rates = (args.rates ?? '2000,10000').split(',').map(Number);
const n = Number(args.n ?? 5000);
const seconds = Number(args.seconds ?? 20);
const warmup = Number(args.warmup ?? 5);
const out = args.out ?? 'perf/results.json';
const throttle = Number(args.throttle ?? 1);

// Thresholds for --check, deliberately loose: CI runners are slow and shared.
export const CHECK = { frameP95Ms: 50, droppedPct: 25, inputP95Ms: 150, staleP95Ms: 500, achievedPct: 90 };

const FRAME = 1000 / 60;

export function pct(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

export function summarise(snap, rate) {
  const dropped = snap.frames.reduce((d, f) => d + Math.max(0, Math.round(f / FRAME) - 1), 0);
  return {
    frames: snap.frames.length,
    frameP50: pct(snap.frames, 0.5),
    frameP95: pct(snap.frames, 0.95),
    frameP99: pct(snap.frames, 0.99),
    frameMax: Math.max(...snap.frames),
    droppedPct: (100 * dropped) / (dropped + snap.frames.length),
    longTasks: snap.longTasks.length,
    longTaskMs: snap.longTasks.reduce((s, l) => s + l.duration, 0),
    inputN: snap.input.length,
    inputP50: pct(snap.input, 0.5),
    inputP95: pct(snap.input, 0.95),
    inputMax: snap.input.length ? Math.max(...snap.input) : null,
    slowEvents: snap.eventTiming.length,
    staleP50: pct(snap.stale, 0.5),
    staleP95: pct(snap.stale, 0.95),
    rendersPerSec: snap.renders / (snap.ms / 1000),
    achievedPerSec: snap.receivedDelta / (snap.ms / 1000),
    achievedPct: rate ? (100 * snap.receivedDelta) / (snap.ms / 1000) / rate : 100,
  };
}

async function measure(browser, base, mode, rate) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  if (throttle > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const path = mode === 'zone' ? '/zone/' : `/?mode=${mode}&`;
  await page.goto(`${base}${path}${path.endsWith('&') ? '' : '?'}perf&rate=${rate}&n=${n}`);
  await page.getByTestId('connection').filter({ hasText: 'Live' }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(warmup * 1000);
  const search = page.getByLabel('Search by name');
  await search.focus();
  const r0 = await page.evaluate(() => {
    window.__perf.reset();
    return window.__perf.received();
  });
  const until = Date.now() + seconds * 1000;
  let k = 0;
  while (Date.now() < until) {
    await page.keyboard.press(k++ % 2 ? 'Backspace' : 'e');
    await page.waitForTimeout(500);
  }
  const snap = await page.evaluate(() => window.__perf.snapshot());
  snap.receivedDelta = snap.received - r0;
  await page.close();
  if (errors.length) throw new Error(`page errors in ${mode}@${rate}: ${errors.join('; ')}`);
  return summarise(snap, rate);
}

async function main() {
  const srv = await startServer({ port: 0, log: null });
  const browser = await chromium.launch({ channel: 'chromium' });
  const version = browser.version();
  const results = [];
  const load0 = loadavg()[0];
  try {
    for (const rate of rates) {
      for (const mode of modes) {
        const r = { mode, rate, n, throttle, ...(await measure(browser, srv.url, mode, rate)) };
        results.push(r);
        console.log(
          `${mode.padEnd(8)} ${String(rate).padStart(6)}/s${throttle > 1 ? ` ×${throttle}` : ''}  frames p50 ${r.frameP50.toFixed(1)} p95 ${r.frameP95.toFixed(1)} ms, ` +
            `dropped ${r.droppedPct.toFixed(1)}%, long tasks ${r.longTasks} (${r.longTaskMs.toFixed(0)} ms), ` +
            `input p50 ${r.inputP50?.toFixed(1)} p95 ${r.inputP95?.toFixed(1)} ms, data age p95 ${r.staleP95?.toFixed(0)} ms, ` +
            `renders ${r.rendersPerSec.toFixed(0)}/s, ` +
            `received ${r.achievedPerSec.toFixed(0)}/s`,
        );
      }
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  const env = {
    date: new Date().toISOString(),
    chromium: version,
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    loadBefore: load0,
    loadAfter: loadavg()[0],
    seconds,
    warmup,
    throttle,
  };
  console.log(`load average ${env.loadBefore.toFixed(1)} → ${env.loadAfter.toFixed(1)} on ${env.cores} cores (${env.cpu})`);
  writeFileSync(out, JSON.stringify({ env, results }, null, 2) + '\n');

  if (args.check) {
    const failures = [];
    for (const r of results.filter((x) => x.mode === 'batched')) {
      const at = `batched@${r.rate}`;
      if (r.frameP95 > CHECK.frameP95Ms) failures.push(`${at}: frame p95 ${r.frameP95.toFixed(1)} ms > ${CHECK.frameP95Ms}`);
      if (r.droppedPct > CHECK.droppedPct) failures.push(`${at}: dropped ${r.droppedPct.toFixed(1)}% > ${CHECK.droppedPct}%`);
      if (r.inputP95 > CHECK.inputP95Ms) failures.push(`${at}: input p95 ${r.inputP95.toFixed(1)} ms > ${CHECK.inputP95Ms}`);
      if (r.staleP95 > CHECK.staleP95Ms) failures.push(`${at}: data age p95 ${r.staleP95.toFixed(0)} ms > ${CHECK.staleP95Ms}`);
      if (r.achievedPct < CHECK.achievedPct) failures.push(`${at}: received ${r.achievedPct.toFixed(0)}% of the rate < ${CHECK.achievedPct}%`);
    }
    if (failures.length) {
      console.error('perf check failed:\n  ' + failures.join('\n  '));
      process.exit(1);
    }
    console.log('perf check passed');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
