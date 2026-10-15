/**
 * Measurement hooks for perf runs (?perf). Records, from the page itself:
 *
 * - every frame's interval (requestAnimationFrame to requestAnimationFrame)
 * - long tasks (over 50 ms) from PerformanceObserver
 * - input delay: from each keydown's timestamp to just after the next
 *   frame is rendered (a message posted from requestAnimationFrame runs
 *   after that frame's style, layout and paint); plus Event Timing entries
 *   of 16 ms or more
 * - data age after each frame (see Telemetry)
 * - how many times Angular rendered (afterEveryRender)
 *
 * perf/run.mjs reads it through window.__perf.
 */
export interface PerfSnapshot {
  frames: number[];
  longTasks: { start: number; duration: number }[];
  input: number[];
  eventTiming: { name: string; duration: number }[];
  stale: number[];
  received: number;
  renders: number;
  ms: number;
}

declare global {
  interface Window {
    __perf?: { reset(): void; snapshot(): PerfSnapshot; stale: number[]; received: () => number; renders: number };
  }
}

export function installPerf(): void {
  let frames: number[] = [];
  let longTasks: PerfSnapshot['longTasks'] = [];
  let input: number[] = [];
  let eventTiming: PerfSnapshot['eventTiming'] = [];
  let since = performance.now();
  let last = 0;

  const loop = (t: number) => {
    if (last) frames.push(t - last);
    last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* not supported */
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) eventTiming.push({ name: e.name, duration: e.duration });
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  } catch {
    /* not supported */
  }
  const channel = new MessageChannel();
  const waiting: number[] = [];
  channel.port1.onmessage = () => {
    const t0 = waiting.shift();
    if (t0 !== undefined) input.push(performance.now() - t0);
  };
  addEventListener(
    'keydown',
    (ev) => {
      const t0 = ev.timeStamp;
      requestAnimationFrame(() => {
        waiting.push(t0);
        channel.port2.postMessage(0);
      });
    },
    { capture: true },
  );

  const perf = {
    stale: [] as number[],
    received: () => 0,
    renders: 0,
    reset() {
      frames = [];
      longTasks = [];
      input = [];
      eventTiming = [];
      perf.stale.length = 0;
      perf.renders = 0;
      since = performance.now();
      last = 0;
    },
    snapshot(): PerfSnapshot {
      return {
        frames: frames.slice(),
        longTasks: longTasks.filter((l) => l.start >= since),
        input: input.slice(),
        eventTiming: eventTiming.slice(),
        stale: perf.stale.slice(),
        received: perf.received(),
        renders: perf.renders,
        ms: performance.now() - since,
      };
    },
  };
  window.__perf = perf;
}
