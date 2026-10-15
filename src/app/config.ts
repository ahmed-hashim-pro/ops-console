import { InjectionToken } from '@angular/core';
import { FleetStore, Mode } from './store';

export interface AppConfig {
  mode: Mode;
  /** Events per second asked of the server. */
  rate: number;
  /** Fleet size. */
  n: number;
  seed: number;
  /** Record frame, input and staleness timings on window.__perf. */
  perf: boolean;
  /** Show pressed keys on screen, for recordings. */
  demo: boolean;
}

export const DEFAULTS: AppConfig = { mode: 'batched', rate: 10000, n: 5000, seed: 1, perf: false, demo: false };

function int(params: URLSearchParams, name: string, lo: number, hi: number, fallback: number): number {
  const raw = params.get(name);
  if (raw === null || raw === '') return fallback;
  const v = Number(raw);
  return Number.isInteger(v) && v >= lo && v <= hi ? v : fallback;
}

/** Reads the query string. `zone` is not a query option: it is the separate zone.js build (main-zone.ts). */
export function readConfig(search: string): AppConfig {
  const p = new URLSearchParams(search);
  return {
    mode: (['eager', 'naive'] as const).find((m) => m === p.get('mode')) ?? 'batched',
    rate: int(p, 'rate', 0, 100000, DEFAULTS.rate),
    n: int(p, 'n', 1, 50000, DEFAULTS.n),
    seed: int(p, 'seed', 0, 2 ** 31 - 1, DEFAULTS.seed),
    perf: p.has('perf'),
    demo: p.has('demo'),
  };
}

export const CONFIG = new InjectionToken<AppConfig>('ops-console config');
export const STORE = new InjectionToken<FleetStore>('fleet store');
