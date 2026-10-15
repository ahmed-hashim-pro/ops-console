import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFleet, createStream, STATUS } from './generator.mjs';
import { startServer } from './server.mjs';

test('the stream is a pure function of seed and size', () => {
  const a = createStream(3, 500);
  const b = createStream(3, 500);
  for (let i = 0; i < 20000; i++) assert.deepEqual(a.next(), b.next());
  const c = createStream(4, 500);
  const differs = Array.from({ length: 100 }, () => JSON.stringify(c.next()) !== JSON.stringify(a.next()));
  assert.ok(differs.some(Boolean));
});

test('events are well formed and the mix is mostly metrics', () => {
  const s = createStream(1, 1000);
  const kinds = [0, 0, 0, 0];
  const open = new Set();
  for (let i = 0; i < 200000; i++) {
    const ev = s.next();
    kinds[ev[0]]++;
    if (ev[0] === 0) {
      assert.equal(ev.length, 5);
      assert.ok(ev[1] >= 0 && ev[1] < 1000);
      assert.ok(ev[2] >= 0 && ev[2] <= 100);
    } else if (ev[0] === 1) {
      assert.ok(ev[2] >= 0 && ev[2] < STATUS.length);
    } else if (ev[0] === 2) {
      assert.ok(!open.has(ev[1]), 'alert ids are unique');
      open.add(ev[1]);
      assert.ok(ev[3] === 1 || ev[3] === 2);
    } else {
      assert.ok(open.delete(ev[1]), 'only open alerts are resolved');
    }
  }
  assert.ok(kinds[0] / 200000 > 0.95, `metrics ${kinds[0]}`);
  assert.ok(kinds[1] > 500 && kinds[2] > 20 && kinds[3] > 20, JSON.stringify(kinds));
});

test('fleet names are unique and carry region and kind', () => {
  const f = createFleet(1, 5000);
  assert.equal(new Set(f.map((e) => e.name)).size, 5000);
  assert.match(f[42].name, new RegExp(`^${f[42].kind}-${f[42].region}-0042$`));
});

async function readEvents(url, count) {
  const res = await fetch(url);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const events = [];
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (block.startsWith('data: ')) events.push(JSON.parse(block.slice(6)));
    }
  }
  await reader.cancel();
  return events.slice(0, count);
}

test('the server streams events at about the rate asked, and resumes where told', async () => {
  const srv = await startServer({ port: 0, log: null });
  try {
    const fleet = await (await fetch(`${srv.url}/fleet?seed=5&n=300`)).json();
    assert.deepEqual(fleet, createFleet(5, 300));

    const t0 = Date.now();
    const events = await readEvents(`${srv.url}/events?seed=5&n=300&rate=2000`, 2000);
    const secs = (Date.now() - t0) / 1000;
    assert.ok(secs > 0.6 && secs < 2.5, `2000 events took ${secs}s`);
    const gen = createStream(5, 300);
    for (const ev of events.slice(0, 500)) assert.deepEqual(ev.slice(0, -1), gen.next());
    assert.ok(Math.abs(events[0].at(-1) - t0) < 2000, 'stamped with the send time');

    const resumed = await readEvents(`${srv.url}/events?seed=5&n=300&rate=2000&from=1500`, 10);
    assert.deepEqual(resumed.map((e) => e.slice(0, -1)), events.slice(1500, 1510).map((e) => e.slice(0, -1)));
  } finally {
    await srv.close();
  }
});

test('the server rejects bad parameters and paths outside the app', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ops-'));
  writeFileSync(join(root, 'index.html'), '<p>app</p>');
  mkdirSync(join(root, 'sub'));
  const srv = await startServer({ port: 0, log: null, root });
  try {
    assert.equal((await fetch(`${srv.url}/fleet?n=0`)).status, 400);
    assert.equal((await fetch(`${srv.url}/events?rate=abc`)).status, 400);
    assert.equal((await fetch(`${srv.url}/some/route`)).status, 200, 'client routes get the app');
    assert.equal(await (await fetch(`${srv.url}/`)).text(), '<p>app</p>');
    assert.equal((await fetch(`${srv.url}/missing.js`)).status, 404);
    // Encoded ../ is resolved inside the root: no file outside it is reachable.
    const escape = await fetch(`${srv.url}/..%2f..%2f..%2fetc%2fpasswd`);
    assert.equal(await escape.text(), '<p>app</p>');
    assert.equal((await fetch(`${srv.url}/health`)).status, 200);
  } finally {
    await srv.close();
  }
});
