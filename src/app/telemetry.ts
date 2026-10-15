import { Injectable, signal } from '@angular/core';

/** Ring of the most recent publishes: when, and how old the oldest event in it was. */
const SAMPLES = 512;

/**
 * Counts what arrives and how fresh it is when it reaches the screen. One
 * tick a second turns the counters into the numbers the header shows.
 *
 * Data age is measured the same way for every store: after each frame (a
 * message posted from requestAnimationFrame runs after the frame is
 * rendered), the age of the oldest event published since the previous
 * frame, from the server's send time.
 */
@Injectable({ providedIn: 'root' })
export class Telemetry {
  readonly eventsPerSec = signal(0);
  /** 95th percentile of data age at publish over the last 5 s, in ms. */
  readonly staleP95 = signal(0);
  /** Events per second for the last 120 s, oldest first. */
  readonly throughput = signal<readonly number[]>([]);

  received = 0;
  private lastReceived = 0;
  private readonly at = new Float64Array(SAMPLES);
  private readonly stale = new Float64Array(SAMPLES);
  private head = 0;
  private filled = 0;
  private history: number[] = [];
  /** Extra sink for perf runs. */
  sink: ((staleMs: number) => void) | null = null;
  private oldest = Infinity;
  private running = false;

  /** A store published events, the oldest sent at `oldestSent` (ms since epoch). */
  published(oldestSent: number): void {
    if (oldestSent < this.oldest) this.oldest = oldestSent;
  }

  /** Starts measuring data age once per frame. */
  start(): void {
    if (this.running || typeof requestAnimationFrame === 'undefined') return;
    this.running = true;
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      if (this.oldest !== Infinity) {
        this.record(Date.now() - this.oldest);
        this.oldest = Infinity;
      }
    };
    const frame = () => {
      channel.port2.postMessage(0);
      if (this.running) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
  }

  record(staleMs: number, now = performance.now()): void {
    this.at[this.head] = now;
    this.stale[this.head] = staleMs;
    this.head = (this.head + 1) % SAMPLES;
    if (this.filled < SAMPLES) this.filled++;
    this.sink?.(staleMs);
  }

  tick(now = performance.now()): void {
    const rate = this.received - this.lastReceived;
    this.lastReceived = this.received;
    this.eventsPerSec.set(rate);
    this.history.push(rate);
    if (this.history.length > 120) this.history.shift();
    this.throughput.set(this.history.slice());
    const recent: number[] = [];
    for (let i = 0; i < this.filled; i++) if (now - this.at[i] <= 5000) recent.push(this.stale[i]);
    this.staleP95.set(recent.length ? percentile(recent, 0.95) : 0);
  }
}

export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[i];
}
