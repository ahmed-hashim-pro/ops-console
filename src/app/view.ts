import { Injectable, computed, inject, signal, untracked } from '@angular/core';
import { STORE } from './config';
import { Entity, STATUS, STATUS_RANK, Status } from './model';

export type SortKey = 'severity' | 'cpu' | 'lat' | 'name';
export const SORT_LABEL: Record<SortKey, string> = {
  severity: 'Severity',
  cpu: 'CPU, highest first',
  lat: 'Latency, highest first',
  name: 'Name',
};

export interface Filters {
  query: string;
  statuses: ReadonlySet<Status>;
  region: string;
  sort: SortKey;
}

/** Filters and orders the fleet; returns entity ids. Pure, so it is tested directly. */
export function orderIds(entities: readonly Entity[], f: Filters): number[] {
  const q = f.query.trim().toLowerCase();
  const all = f.statuses.size === STATUS.length;
  const out: Entity[] = [];
  for (const e of entities) {
    if (!all && !f.statuses.has(e.status)) continue;
    if (f.region !== 'all' && e.region !== f.region) continue;
    if (q && !e.name.includes(q)) continue;
    out.push(e);
  }
  const byName = (a: Entity, b: Entity) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  switch (f.sort) {
    case 'severity':
      out.sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || b.alerts - a.alerts || b.cpu - a.cpu || a.id - b.id);
      break;
    case 'cpu':
      out.sort((a, b) => b.cpu - a.cpu || a.id - b.id);
      break;
    case 'lat':
      out.sort((a, b) => b.lat - a.lat || a.id - b.id);
      break;
    case 'name':
      out.sort(byName);
      break;
  }
  return out.map((e) => e.id);
}

/** How often the batched view re-sorts while data streams in. */
export const REORDER_MS = 1000;

/**
 * What the user is looking at: filters, the ordered rows, the selected
 * entity, and whether the order is frozen because the keyboard is in the
 * table (rows must not move under the focus).
 */
@Injectable({ providedIn: 'root' })
export class FleetView {
  private readonly store = inject(STORE);

  readonly query = signal('');
  readonly statuses = signal<ReadonlySet<Status>>(new Set(STATUS));
  readonly region = signal('all');
  readonly sort = signal<SortKey>('severity');
  /** True while focus is inside the table. */
  readonly frozen = signal(false);
  readonly selected = signal<number | null>(null);
  /** Bumped every REORDER_MS by the app. */
  readonly tick = signal(0);

  readonly filters = computed<Filters>(() => ({
    query: this.query(),
    statuses: this.statuses(),
    region: this.region(),
    sort: this.sort(),
  }));

  private prev: number[] = [];
  private prevFilters: Filters | null = null;

  /**
   * Ordered ids, re-ordered once a second (`tick`) in every mode, and at
   * once when a filter changes. While frozen the order is kept.
   */
  readonly rows = computed<readonly number[]>(() => {
    this.tick();
    const f = this.filters();
    const frozen = this.frozen();
    return untracked(() => {
      if (frozen && f === this.prevFilters) return this.prev;
      this.prev = orderIds(this.store.entities(), f);
      this.prevFilters = f;
      return this.prev;
    });
  });

  readonly total = computed(() => this.store.entities().length);

  toggleStatus(s: Status): void {
    const next = new Set(this.statuses());
    if (next.has(s)) next.delete(s);
    else next.add(s);
    this.statuses.set(next);
  }
}
