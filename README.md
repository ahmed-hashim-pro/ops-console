# ops-console

[![CI](https://github.com/ahmed-hashim-pro/ops-console/actions/workflows/ci.yml/badge.svg)](https://github.com/ahmed-hashim-pro/ops-console/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A real-time operations dashboard in Angular 22: zoneless change detection,
signals, standalone components. 5,000 services stream status, metrics and
alerts at 10,000 events a second. The dashboard stays at 60 frames a second
while you search and sort, and you can run all of it from the keyboard.

Live data is where dashboards go wrong in two ways. The first is speed:
it's easy to do work per event, and at a few thousand events a second that
work becomes dropped frames and a search box that lags. The second is
accessibility. Rows move under the keyboard focus, a screen reader announces
every update, and nothing can be paused. This repository treats both as
claims to measure rather than promises:

- **Frames, input delay and data age** are measured in Chromium. The same
  app runs with four different ways of applying events, at rates from 2,000
  to 40,000 a second, on a normal CPU and on a 4× slower one.
- **Memory** is measured over a ten-minute soak at 10,000 events a second.
- **Accessibility** is checked with axe-core, with no violations in either
  theme across four audits of different UI states. Every feature also has a
  Playwright test that uses only the keyboard.

![Recording of the dashboard at 10,000 events a second, driven only from the keyboard, with each key shown on screen. The summary tiles show about 4,600 OK, 150 warning, 160 critical and 25 offline services, 10,000 events per second and a data age around 20 ms. Pressing / focuses the search box; typing eu-west filters the table to 846 of 5,000. Tab moves into the table, the arrow keys, Page Down and Home move between rows, and the note under the table changes to say the row order is held while focus is in the table. Enter opens a details panel with CPU and latency sparklines, and Escape closes it, returning focus to the same row. Pressing p shows a Paused chip and freezes the numbers; p again resumes. Pressing ? opens the keyboard shortcuts dialog, and Escape closes it.](docs/demo.gif)

## Measurements

![Two bar charts. Dropped frames: at 10,000 events a second all four stores drop none. At 20,000, naive drops 14% and zone.js 96%; at 40,000, naive 98% and zone.js 99%; batched and eager drop none at any rate. With a 4× slower CPU, at 5,000 events a second naive drops 34% and zone.js 28%; at 10,000 both drop 99%, against 0.1% for batched and 0.5% for eager. Input delay at the 95th percentile follows the same pattern: 30 to 47 ms for batched and eager everywhere; 1.6 to 2.3 seconds for naive and zone.js at 40,000 a second; 7.2 and 9.9 seconds for naive and zone.js at 10,000 a second on the slower CPU.](docs/perf.svg)

These are the four ways of applying events. Everything else is the same
code: components, ordering and the event stream.

| Store | What one event does |
| --- | --- |
| **batched** (the default) | Writes the newest values into typed arrays. Once per animation frame they are applied to the entities and one signal is bumped. At 10,000 events a second that folds about 170 events into each update. |
| **eager** | The same store, but it applies each event and bumps the signals at once. |
| **naive** | What a straightforward signal store does: a new entity list per event (`list.map(e => e.id === id ? {...e, ...} : e)`), then set the signals. |
| **zone** | The eager store in a zone.js build of the app. zone.js runs change detection after every event handler, so it renders once per event. |

What the numbers say:

- **The two collapses are per-event rendering and per-event copying.** The
  zone.js build renders once per event (10,065 renders a second at 10,000
  events) and falls over at 20,000 events a second. The naive store copies a
  5,000-entry list per event. It starts dropping frames at 20,000 and falls
  over at 40,000. On a CPU four times slower, both struggle at 5,000 and fall
  over at 10,000. At that point the screen updates
  every few seconds and keystrokes wait seven to ten seconds.
- **Zoneless Angular already does most of the batching.** The eager store
  writes signals on every event, yet it renders only about 100 times a
  second. Angular's zoneless scheduler coalesces those writes into its own
  render. Eager is within noise of batched in every condition here. What
  batching per frame still buys is a fixed cost per frame: 60 renders a
  second instead of about 100, and work that stops growing with the event
  rate. It's the default for that reason, but it is not what saves the
  dashboard. Not rendering per event, and not copying per event, is.
- **Data age** is the time from the server sending an event to the end of
  the frame that first shows it. It is about 20 ms for every store that
  keeps up: one frame of batching costs at most one frame of age. Once a
  store falls behind, its age grows into seconds, because events queue in
  the browser faster than they are handled: at 40,000 a second, zone.js
  handles 20,397 and naive 31,035.

<details>
<summary>Every number (frame p95, long tasks, input p50, data age, renders)</summary>

| Condition | Store | Dropped frames | Frame p95 | Long tasks | Input delay p50 / p95 | Data age p95 | Events handled/s | Renders/s |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10,000/s | batched | 0.0% | 16.7 ms | 0 (0 ms) | 19 / 37 ms | 23 ms | 10,001 | 60 |
| 10,000/s | eager | 0.0% | 16.8 ms | 0 (0 ms) | 17 / 35 ms | 21 ms | 10,002 | 100 |
| 10,000/s | naive | 0.0% | 16.7 ms | 0 (0 ms) | 18 / 30 ms | 19 ms | 10,000 | 99 |
| 10,000/s | zone | 0.0% | 16.7 ms | 0 (0 ms) | 24 / 40 ms | 19 ms | 9,999 | 10,065 |
| 20,000/s | batched | 0.0% | 16.7 ms | 0 (0 ms) | 18 / 30 ms | 23 ms | 20,007 | 59 |
| 20,000/s | eager | 0.0% | 16.7 ms | 0 (0 ms) | 20 / 33 ms | 22 ms | 19,999 | 100 |
| 20,000/s | naive | 14.0% | 16.8 ms | 25 (2546 ms) | 36 / 176 ms | 40 ms | 20,001 | 79 |
| 20,000/s | zone | 95.9% | 1283.3 ms | 32 (20796 ms) | 1927 / 2114 ms | 1.7 s | 19,585 | 19,590 |
| 40,000/s | batched | 0.0% | 16.7 ms | 0 (0 ms) | 18 / 33 ms | 24 ms | 40,000 | 59 |
| 40,000/s | eager | 0.0% | 16.7 ms | 0 (0 ms) | 18 / 34 ms | 23 ms | 39,993 | 99 |
| 40,000/s | naive | 97.9% | 883.4 ms | 28 (18834 ms) | 1037 / 1622 ms | 7.9 s | 31,035 | 1 |
| 40,000/s | zone | 98.6% | 1316.7 ms | 20 (21086 ms) | 1875 / 2277 ms | 12.8 s | 20,397 | 20,400 |
| 2,000/s, 4× slower CPU | batched | 0.0% | 16.8 ms | 0 (0 ms) | 27 / 35 ms | 23 ms | 2,000 | 62 |
| 2,000/s, 4× slower CPU | eager | 0.0% | 16.7 ms | 0 (0 ms) | 25 / 34 ms | 21 ms | 2,000 | 98 |
| 2,000/s, 4× slower CPU | naive | 0.0% | 16.7 ms | 0 (0 ms) | 37 / 51 ms | 27 ms | 2,000 | 95 |
| 2,000/s, 4× slower CPU | zone | 0.0% | 16.8 ms | 0 (0 ms) | 29 / 40 ms | 21 ms | 2,000 | 2,066 |
| 5,000/s, 4× slower CPU | batched | 0.0% | 16.7 ms | 0 (0 ms) | 29 / 39 ms | 27 ms | 4,999 | 60 |
| 5,000/s, 4× slower CPU | eager | 0.0% | 16.8 ms | 0 (0 ms) | 32 / 39 ms | 28 ms | 5,002 | 97 |
| 5,000/s, 4× slower CPU | naive | 33.9% | 66.7 ms | 50 (3997 ms) | 97 / 274 ms | 100 ms | 5,001 | 51 |
| 5,000/s, 4× slower CPU | zone | 27.9% | 50.1 ms | 36 (3722 ms) | 78 / 404 ms | 85 ms | 4,993 | 5,042 |
| 10,000/s, 4× slower CPU | batched | 0.1% | 16.8 ms | 0 (0 ms) | 34 / 47 ms | 35 ms | 10,000 | 59 |
| 10,000/s, 4× slower CPU | eager | 0.5% | 16.8 ms | 0 (0 ms) | 36 / 47 ms | 35 ms | 10,000 | 94 |
| 10,000/s, 4× slower CPU | naive | 99.1% | 4049.8 ms | 7 (18789 ms) | 6286 / 7230 ms | 18.2 s | 7,110 | 0 |
| 10,000/s, 4× slower CPU | zone | 99.3% | 5033.2 ms | 5 (18586 ms) | 9373 / 9927 ms | 27.7 s | 4,920 | 4,921 |

</details>

**Memory.** I ran the batched store at 10,000 events a second for ten
minutes, with the details panel open. After every 30 seconds I forced a
garbage collection and read the heap and the DOM node count. Over 6.3 million
events, the heap was 4.8 MB at 30 seconds. After the two-minute warm-up it
stayed between 5.00 and 5.10 MB and ended at 5.08. DOM nodes stayed between
1,830 and 1,851. Every buffer has a fixed size: two minutes of history per
entity in two ring buffers, the newest 500 alerts, and a window of table rows.
The run is in `perf/soak.json`, and CI repeats it on every push.

**How it was measured.** `perf/run.mjs` drives the production build in
Chromium 156 (Playwright, new headless mode), 1400 × 900, with 5,000
entities. Each condition gets a fresh page, 5 seconds of warm-up, then 20
seconds of measurement, while a scripted user types a character or
Backspace into the search box every 500 ms. Each filter change re-sorts
the table. The page records its own timings (`src/app/perf.ts`):

- **Frames:** every requestAnimationFrame interval. Dropped frames are the
  frames missed between callbacks.
- **Long tasks:** from PerformanceObserver.
- **Input delay:** from each keydown's timestamp until just after the next
  frame is rendered.
- **Data age:** see above.
- **Renders:** Angular's `afterEveryRender` count.

"4× slower CPU" is Chrome's CPU throttling (DevTools' "4x slowdown"). It
is the setting Lighthouse uses to stand in for a mid-range phone. The machine is an Intel i5-12400F
with 12 threads. Its load average was 2.2 at the start and 1.4 at the end,
with other work running on it. Regenerate everything with `make perf`
(about twelve minutes).

## Quickstart

With Docker only:

```bash
git clone https://github.com/ahmed-hashim-pro/ops-console.git
cd ops-console
make run                      # builds, then serves http://localhost:8080
```

With Node 22 or newer:

```bash
npm ci
npm start                     # builds, then serves http://127.0.0.1:8080
```

The query string chooses what you see:

| URL | |
| --- | --- |
| `/` | 5,000 entities at 10,000 events/s, batched store |
| `/?rate=40000` | events per second, 0 to 100,000 |
| `/?n=20000&seed=7` | fleet size and the random seed of the stream |
| `/?mode=eager`, `/?mode=naive` | the other stores |
| `/zone/` | the zone.js build (takes the same `rate`, `n` and `seed`) |
| `/?demo` | shows each key pressed, for recordings |

Tests:

```bash
make test        # 24 unit tests (Vitest) + 5 server tests (node:test)
make e2e         # 28 Playwright tests: keyboard-only, axe, every store
make perf-check  # the batched store at 10,000/s against CI's thresholds
make soak        # ten minutes; fails if the heap or DOM keeps growing
make perf        # the whole comparison above, and docs/perf.svg
make demo        # re-records docs/demo.gif
```

`LOCAL=1 make …` runs the same targets without Docker. You need Node 22, and
for the browser targets `npx playwright install chromium`.

## Keyboard

| Key | |
| --- | --- |
| <kbd>Tab</kbd> | The skip link first; then the header buttons, search, filters, the table (one stop), details, alerts |
| <kbd>/</kbd> | Search by name |
| <kbd>p</kbd> | Pause or resume updates |
| <kbd>?</kbd> | Keyboard shortcuts (where the single-key shortcuts can be turned off) |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>PgUp</kbd> <kbd>PgDn</kbd> <kbd>Home</kbd> <kbd>End</kbd> | In the table: move between rows, scrolling as needed |
| <kbd>Enter</kbd> | Open the row's details; focus moves to its heading |
| <kbd>Esc</kbd> | Close details or the dialog; focus goes back where it came from |

## How it works

**The stream.** `server/server.mjs` is a dependency-free Node server. It
serves the built app and an SSE endpoint, sending one message per event, as
most real event sources deliver them. `server/generator.mjs` makes the
events:

- **Determinism:** the events are a pure function of a seed. The same seed
  gives the tests, the perf runs and the demo the same stream.
- **Contents:** about 99% are metric samples. The rest are status changes,
  plus alerts raised from trouble and resolved later.
- **Incidents:** every so often a region has one, and its services go
  critical together.
- **Send time:** every event carries its send time. That's how data age is
  measured.
- **Slow clients:** if the client can't keep up, the socket fills and the
  server waits. Events are delayed, never dropped.
- **Reconnects:** the client resumes with `from=<count>`, so the sequence
  continues instead of restarting.

**The stores** (`src/app/store.ts`) implement one interface. The zone.js
build is the same app with `provideZoneChangeDetection()`. One finding from
building it: zone.js 0.16 tracks `eventSource.addEventListener('message', …)`
but not `eventSource.onmessage = …`. With `onmessage`, the zone app quietly
rendered only on signal changes (163 times a second rather than once per
event), so the stream uses `addEventListener`, as a zone app normally would.
`store.spec.ts` feeds the same 30,000 generated events to batched, eager and
naive, with frames at arbitrary points, a silence and an acknowledgement. It
checks that all three end in exactly the same state. That test caught one
real bug: the batched store's Float32 buffers turned 43.7 into
43.70000076.

**The table** is a real `<table>`, virtualised by hand: only the rows in
view plus six either side are in the DOM, with hidden spacer rows holding the
scroll height. `aria-rowcount` and `aria-rowindex` tell assistive technology
where each row sits in the whole list. Each row's name is a button, and only
one is in the tab order. The arrow keys move a roving tabindex, scrolling the
row into view first if needed. The order re-sorts once a second. While focus
is anywhere in the table it holds still, so rows never move under the
keyboard. The values still update, and a note under the table says so.

**Charts** are a few lines of canvas, with no chart library. Every chart is
`role="img"` with a text alternative ("CPU over the last 120 seconds: low
12.0 %, high 88.3 %, now 45.0 %"), and its numbers are also shown as visible
text.

**Accessibility.** The features, and how each is checked:

| Feature | How it's checked |
| --- | --- |
| No axe-core violations (WCAG 2.1 A and AA) in light and dark themes, in four audits: the dashboard streaming; details open with an alert acknowledged and updates paused; the shortcuts dialog; a search with no results | `e2e/a11y.spec.ts` |
| Every feature works from the keyboard alone: skip link, search, status checkboxes, region and sort, row navigation, details, silence and unsilence, acknowledge, pause, theme, shortcuts dialog | `e2e/keyboard.spec.ts`. These tests never click or call `focus()` |
| Focus is never lost. When the button just pressed disappears ("Acknowledge" → "Acknowledged", "Silence" → "Unsilence"), focus moves to its replacement. Closing details returns focus to whatever opened them | `e2e/keyboard.spec.ts` |
| Alerts are announced in a polite live region at most once every ten seconds, as one summary ("3 new critical alerts, first db-us-east-0042"). The level is set to critical, all or off | `e2e/a11y.spec.ts`: no more than 3 announcements in 21 s with dozens of alerts arriving |
| The alert list holds still while focus is in it, with new alerts behind a "Show N new alerts" button | `e2e/keyboard.spec.ts` |
| Updates can be paused (WCAG 2.2.2) | `e2e/keyboard.spec.ts` |
| Single-key shortcuts can be turned off (WCAG 2.1.4) | `e2e/keyboard.spec.ts` |
| Status is never shown by colour alone: a shape and the word go with it. Text contrast meets AA in both themes | `e2e/a11y.spec.ts` (axe's contrast rule) |
| Chart lines and the focus ring are 3:1 or better against their background (lines 5.1–6.8:1, focus ring 5.2–9.7:1) | Computed from the colour tokens in `src/styles.css`. axe can't see into a canvas |
| Nothing animates or flashes. Updated cells don't flash, and `prefers-reduced-motion` turns off any transition | `e2e/a11y.spec.ts` |

## What this does not do

- **It has not been tried with a screen reader.** The roles, names, live
  regions and focus order are tested automatically, and those tests are
  listed above. Nobody has used it with NVDA, JAWS or VoiceOver. The live
  regions and the virtual table are where a screen reader test would most
  likely find something.
- **The numbers come from one machine, in headless Chromium, over
  loopback.** "4× slower CPU" is Chrome's throttling, not a real slower
  device. Firefox and Safari were not measured, and neither were real
  networks or real phones. CI runs only a short check of the batched store,
  against thresholds well below what this machine shows.
- **The data is synthetic.** The rates, alert mix and incidents are a model.
  There is no backend beyond the generator, so acknowledgements and
  silences live only in the page.
- **The naive store is one common pattern, not the worst one.** A store
  that also re-sorted on every event, or rendered every row, would do worse;
  a per-entity signal store would do better. The comparison isolates exactly
  one thing.
- **The table has no column resizing or multi-select, and it doesn't stay
  put if you scroll it with a mouse.** If you scroll the focused row out of
  view with a mouse, the row leaves the DOM and focus goes back to the page.
  Keyboard navigation always keeps the focused row in view.
- **It does no authentication, persistence or real alert routing.** It is a
  front end and a test bench, not an alerting product.

## Layout

```
server/            generator.mjs (the stream), server.mjs (SSE + static), tests
src/app/
  store.ts         the four ways of applying events
  view.ts          filters, ordering, freeze-while-focused
  stream.ts        EventSource → store
  telemetry.ts     events/s, data age
  history.ts       2 minutes of per-entity samples in two ring buffers
  announcer.ts     the two live regions
  perf.ts          measurement hooks (?perf)
  components/      table, details, alerts, filters, summary, sparkline, dialog
src/main-zone.ts   the zone.js build
e2e/               Playwright: keyboard, a11y, modes
perf/              run.mjs (frames), soak.mjs (memory), chart.mjs, results
scripts/demo.mjs   records docs/demo.gif
```

## License

MIT
