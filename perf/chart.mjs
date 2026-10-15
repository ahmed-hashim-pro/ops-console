// Draws docs/perf.svg from perf/results-desktop.json and
// perf/results-throttled.json: dropped frames and input delay (p95) for
// each store, per event rate, on a normal and a 4x slower CPU.
//
//   node perf/chart.mjs
//
// Two small multiples with one axis each (no dual axes), horizontal bars
// grouped by condition, colour by store in a fixed order, and every bar
// labelled with its value (two of the four colours are under 3:1 against
// the background, so the numbers carry the reading; the README has the
// full table too).

import { readFileSync, writeFileSync } from 'node:fs';

const MODES = [
  ['batched', 'Batched (one update per frame)', '#2a78d6'],
  ['eager', 'Eager (one update per event)', '#eb6834'],
  ['naive', 'Naive (new list per event)', '#1baf7a'],
  ['zone', 'zone.js (render per event)', '#eda100'],
];

const runs = [
  ['perf/results-desktop.json', ''],
  ['perf/results-throttled.json', ', 4× slower CPU'],
];
const conditions = [];
for (const [file, suffix] of runs) {
  const { results } = JSON.parse(readFileSync(file, 'utf8'));
  for (const rate of [...new Set(results.map((r) => r.rate))]) {
    conditions.push({
      label: `${rate.toLocaleString('en')}/s${suffix}`,
      byMode: Object.fromEntries(results.filter((r) => r.rate === rate).map((r) => [r.mode, r])),
    });
  }
}

const panels = [
  { title: 'Dropped frames', unit: '%', key: 'droppedPct', fmt: (v) => `${v.toFixed(1)}%` },
  { title: 'Input delay, 95th percentile', unit: 'ms', key: 'inputP95', fmt: (v) => `${Math.round(v)} ms` },
];

const W = 1000;
const LABEL_W = 170;
const PANEL_GAP = 40;
const PANEL_W = (W - LABEL_W - 24 - PANEL_GAP) / 2;
const BAR = 9;
const BAR_GAP = 2;
const GROUP_GAP = 16;
const TOP = 104;
const groupH = MODES.length * (BAR + BAR_GAP) - BAR_GAP;
const H = TOP + conditions.length * (groupH + GROUP_GAP) + 36;
const ink = '#0b0b0b';
const ink2 = '#52514e';
const grid = '#e4e3df';
const font = `-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}">
<rect width="100%" height="100%" fill="#fcfcfb"/>
<text x="24" y="30" font-size="17" font-weight="600" fill="${ink}">The same dashboard with four ways of applying events</text>
<text x="24" y="50" font-size="12.5" fill="${ink2}">5,000 entities, Chromium, ${conditions.length} conditions × 20 s each, a keystroke every 500 ms. Lower is better.</text>
`;
// Legend
let lx = 24;
for (const [, label, color] of MODES) {
  svg += `<rect x="${lx}" y="66" width="12" height="12" rx="2" fill="${color}"/><text x="${lx + 18}" y="76.5" font-size="12.5" fill="${ink}">${esc(label)}</text>\n`;
  lx += 18 + label.length * 6.7 + 22;
}

panels.forEach((p, pi) => {
  const x0 = LABEL_W + 24 + pi * (PANEL_W + PANEL_GAP);
  const values = conditions.flatMap((c) => MODES.map(([m]) => c.byMode[m]?.[p.key] ?? 0));
  const max = niceMax(Math.max(...values, 1));
  const sx = (v) => x0 + (Math.max(0, v) / max) * (PANEL_W - 64);
  svg += `<text x="${x0}" y="${TOP - 10}" font-size="13" font-weight="600" fill="${ink}">${esc(p.title)}</text>\n`;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const x = sx(v);
    svg += `<line x1="${x}" y1="${TOP}" x2="${x}" y2="${H - 30}" stroke="${grid}"/>`;
    svg += `<text x="${x}" y="${H - 14}" font-size="11" text-anchor="middle" fill="${ink2}">${esc(p.fmt(v).replace('.0%', '%'))}</text>\n`;
  }
  conditions.forEach((c, ci) => {
    const gy = TOP + 6 + ci * (groupH + GROUP_GAP);
    if (pi === 0) svg += `<text x="${LABEL_W + 10}" y="${gy + groupH / 2 + 4}" font-size="12.5" text-anchor="end" fill="${ink}">${esc(c.label)}</text>\n`;
    MODES.forEach(([m, , color], mi) => {
      const r = c.byMode[m];
      if (!r) return;
      const v = r[p.key];
      const y = gy + mi * (BAR + BAR_GAP);
      const w = Math.max(2, sx(v) - x0);
      svg += `<path d="M${x0} ${y}h${w - 3}a3 3 0 0 1 3 3v${BAR - 6}a3 3 0 0 1 -3 3h${-(w - 3)}z" fill="${color}"/>`;
      svg += `<text x="${x0 + w + 5}" y="${y + BAR - 0.5}" font-size="10.5" fill="${ink2}">${esc(p.fmt(v))}</text>\n`;
    });
  });
});
svg += '</svg>\n';
writeFileSync('docs/perf.svg', svg);
console.log(`wrote docs/perf.svg (${conditions.length} conditions)`);

const fmtAge = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

// The same numbers as a Markdown table, for the README.
const rows = [
  '| Condition | Store | Dropped frames | Frame p95 | Long tasks | Input delay p50 / p95 | Data age p95 | Events handled/s | Renders/s |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];
for (const c of conditions)
  for (const [m] of MODES) {
    const r = c.byMode[m];
    if (!r) continue;
    rows.push(
      `| ${c.label} | ${m} | ${r.droppedPct.toFixed(1)}% | ${r.frameP95.toFixed(1)} ms | ${r.longTasks} (${Math.round(r.longTaskMs)} ms) | ${Math.round(r.inputP50)} / ${Math.round(r.inputP95)} ms | ${fmtAge(r.staleP95)} | ${Math.round(r.achievedPerSec).toLocaleString('en')} | ${Math.round(r.rendersPerSec).toLocaleString('en')} |`,
    );
  }
writeFileSync('perf/table.md', rows.join('\n') + '\n');
console.log('wrote perf/table.md');
