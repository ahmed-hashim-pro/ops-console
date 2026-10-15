import { nextRow } from './components/fleet-table';
import { sparkSummary } from './components/sparkline';
import { readConfig } from './config';
import { percentile } from './telemetry';

describe('nextRow', () => {
  it('moves by one, by a page, and to either end, staying in range', () => {
    expect(nextRow('ArrowDown', 3, 10, 5)).toBe(4);
    expect(nextRow('ArrowUp', 0, 10, 5)).toBe(0);
    expect(nextRow('ArrowDown', 9, 10, 5)).toBe(9);
    expect(nextRow('PageDown', 3, 10, 5)).toBe(8);
    expect(nextRow('PageDown', 8, 10, 5)).toBe(9);
    expect(nextRow('PageUp', 3, 10, 5)).toBe(0);
    expect(nextRow('Home', 7, 10, 5)).toBe(0);
    expect(nextRow('End', 2, 10, 5)).toBe(9);
    expect(nextRow('a', 2, 10, 5)).toBeNull();
    expect(nextRow('ArrowDown', 0, 0, 5)).toBeNull();
  });
});

describe('sparkSummary', () => {
  it('describes the chart in words', () => {
    expect(sparkSummary('CPU', '%', [])).toBe('CPU: no samples yet');
    expect(sparkSummary('CPU', '%', [12, 88.25, 45])).toBe('CPU over the last 3 seconds: low 12.0 %, high 88.3 %, now 45.0 %');
  });
});

describe('readConfig', () => {
  it('reads the query string and ignores bad values', () => {
    expect(readConfig('?mode=naive&rate=500&n=20&seed=4&perf')).toMatchObject({ mode: 'naive', rate: 500, n: 20, seed: 4, perf: true, demo: false });
    expect(readConfig('?mode=zone&rate=-1&n=abc')).toMatchObject({ mode: 'batched', rate: 10000, n: 5000 });
  });
});

describe('percentile', () => {
  it('is the nearest-rank percentile', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 0.5)).toBe(50);
    expect(percentile(v, 0.95)).toBe(95);
    expect(percentile([7], 0.95)).toBe(7);
  });
});
