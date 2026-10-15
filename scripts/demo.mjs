// Records docs/demo.gif: the real app at 10,000 events a second, driven
// from the keyboard alone, with the keys shown on screen (?demo).
//
//   docker build -f docker/demo.Dockerfile -t ops-console-demo .
//   docker run --rm --ipc=host -v "$PWD":/w -w /w ops-console-demo node scripts/demo.mjs
//
// Needs a build (npm run build). Writes docs/demo.gif.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/server.mjs';

const W = 1280;
const H = 760;
const dir = mkdtempSync(join(tmpdir(), 'demo-'));
const srv = await startServer({ port: 0, log: null });
const browser = await chromium.launch({ channel: 'chromium' });
const context = await browser.newContext({
  viewport: { width: W, height: H },
  colorScheme: 'light',
  recordVideo: { dir, size: { width: W, height: H } },
});
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);
const press = async (key, ms = 450) => {
  await page.keyboard.press(key);
  await pause(ms);
};

await page.goto(`${srv.url}/?demo&rate=10000&n=5000&seed=1`);
await page.getByTestId('connection').filter({ hasText: 'Live' }).waitFor();
await pause(3500);

// Search, then into the table.
await press('/');
for (const ch of 'eu-west') await press(ch, 90);
await pause(1200);
for (let i = 0; i < 7; i++) await press('Tab', 160);
await pause(400);
for (let i = 0; i < 3; i++) await press('ArrowDown', 500);
await press('PageDown', 900);
await press('Home', 700);
await press('Enter', 3500); // details, with two minutes of history so far
await press('Escape', 900);

// Pause and resume.
await press('p', 2000);
await press('p', 1200);

// Shortcuts dialog.
await press('?', 2200);
await press('Escape', 800);

const video = page.video();
await context.close();
await browser.close();
await srv.close();
const webm = await video.path();

// Two-pass palette for a clean, small GIF.
const palette = join(dir, 'palette.png');
// The numbers change in every frame, so keep the frame rate and palette modest.
const filters = 'fps=8,scale=880:-1:flags=lanczos';
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.2', '-i', webm, '-vf', `${filters},palettegen=max_colors=64:stats_mode=diff`, palette]);
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-ss', '1.2', '-i', webm, '-i', palette,
  '-lavfi', `${filters} [x]; [x][1:v] paletteuse=dither=none:diff_mode=rectangle`,
  'docs/demo.gif',
]);
execFileSync('cp', [webm, 'tmp/demo.webm']);
console.log('wrote docs/demo.gif from', readdirSync(dir).join(', '));
rmSync(dir, { recursive: true, force: true });
