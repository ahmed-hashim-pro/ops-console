import { Injectable, inject, signal, untracked } from '@angular/core';
import { STORE } from './config';

/** Seconds of history kept per entity. */
export const HISTORY = 120;

/**
 * One sample a second of every entity's CPU and latency, in two flat
 * ring buffers: fixed memory however long the dashboard runs.
 */
@Injectable({ providedIn: 'root' })
export class History {
  private readonly store = inject(STORE);
  private readonly n = untracked(this.store.entities).length;
  readonly cpu = new Float32Array(this.n * HISTORY);
  readonly lat = new Float32Array(this.n * HISTORY);
  /** Next slot to write. */
  head = 0;
  /** Samples written so far, up to HISTORY. */
  length = 0;
  /** Bumped after each sample, so charts redraw once a second. */
  readonly version = signal(0);

  sample(): void {
    if (untracked(this.store.paused)) return;
    const list = untracked(this.store.entities);
    const h = this.head;
    for (let id = 0; id < this.n; id++) {
      this.cpu[id * HISTORY + h] = list[id].cpu;
      this.lat[id * HISTORY + h] = list[id].lat;
    }
    this.head = (h + 1) % HISTORY;
    if (this.length < HISTORY) this.length++;
    this.version.update((v) => v + 1);
  }

  /** An entity's samples, oldest first. */
  series(which: 'cpu' | 'lat', id: number): number[] {
    const buf = which === 'cpu' ? this.cpu : this.lat;
    const out: number[] = [];
    const start = (this.head - this.length + HISTORY) % HISTORY;
    for (let i = 0; i < this.length; i++) out.push(buf[id * HISTORY + ((start + i) % HISTORY)]);
    return out;
  }
}
