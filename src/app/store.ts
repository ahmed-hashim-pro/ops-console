import { Signal, WritableSignal, signal } from '@angular/core';
import {
  ALERT,
  ALERT_CODES,
  Alert,
  Entity,
  FleetMember,
  METRIC,
  RESOLVE,
  STATUS,
  STATUS_CHANGE,
  Stats,
  Tuple,
  emptyStats,
  newEntity,
} from './model';

/** How many alerts the feed keeps, newest first. Older ones are dropped. */
export const ALERT_CAP = 500;

export type Mode = 'batched' | 'eager' | 'naive' | 'zone';

export const MODE_LABEL: Record<Mode, string> = {
  batched: 'Batched store (one update per frame)',
  eager: 'Eager store (one update per event)',
  naive: 'Naive store (a new list per event)',
  zone: 'Eager store with zone.js change detection',
};

/**
 * The state behind the dashboard. The modes differ only in how an event
 * reaches the screen; components, ordering and everything else are shared,
 * so a perf run compares exactly that:
 *
 * - `batched`: `BatchedStore` keeps the newest value per entity in typed
 *   arrays as events arrive and applies them once per animation frame,
 *   bumping `version` once. At 10,000 events a second that folds about 170
 *   events into one update.
 * - `eager`: the same store publishing after every event. Angular's
 *   zoneless scheduler still renders at most once per frame, but every
 *   event writes the signals.
 * - `naive`: `NaiveStore`, what a straightforward signal store does: every
 *   event replaces the entity list with an updated copy and sets the signals.
 * - `zone`: the eager store in an app using zone.js, which runs change
 *   detection after every event handler, so after every event.
 */
export interface FleetStore {
  readonly mode: Mode;
  /** Changes whenever any entity's values change. Read it to re-render visible values. */
  readonly version: Signal<number>;
  /** Indexed by entity id. The batched store keeps one array and mutates it; read `version` too. */
  readonly entities: Signal<readonly Entity[]>;
  readonly alerts: Signal<readonly Alert[]>;
  readonly stats: Signal<Stats>;
  readonly paused: Signal<boolean>;
  readonly silenced: Signal<ReadonlyMap<number, number>>;
  ingest(t: Tuple): void;
  setPaused(paused: boolean): void;
  acknowledge(alertId: number): void;
  /** Hide new alerts from this entity until `until` (ms since epoch). */
  silence(entityId: number, until: number): void;
  unsilence(entityId: number): void;
  /** Called after each publish with the send time (ms since epoch) of the oldest event in it. */
  onPublish: ((oldestSent: number, events: number) => void) | null;
  /** Called for each alert that reaches the feed (not silenced). */
  onAlert: ((a: Alert) => void) | null;
}

export interface StoreOptions {
  now?: () => number;
  /** How a publish is scheduled. Defaults to requestAnimationFrame. */
  schedule?: (cb: () => void) => void;
}

function alertFrom(t: Tuple, entity: Entity): Alert {
  return {
    id: t[1],
    entityId: t[2],
    entityName: entity.name,
    severity: t[3] === 2 ? 'critical' : 'warning',
    code: ALERT_CODES[t[4]] ?? ALERT_CODES[0],
    raisedAt: t[t.length - 1],
    resolvedAt: null,
    acknowledged: false,
  };
}

const PENDING_METRIC = 1;
const PENDING_STATUS = 2;

export class BatchedStore implements FleetStore {
  onPublish: FleetStore['onPublish'] = null;
  onAlert: FleetStore['onAlert'] = null;

  private readonly list: Entity[];
  private readonly _version = signal(0);
  private readonly _entities: WritableSignal<readonly Entity[]>;
  private readonly _alerts = signal<readonly Alert[]>([]);
  private readonly _stats: WritableSignal<Stats>;
  private readonly _paused = signal(false);
  private readonly _silenced = signal<ReadonlyMap<number, number>>(new Map());
  readonly version = this._version.asReadonly();
  readonly entities: Signal<readonly Entity[]>;
  readonly alerts = this._alerts.asReadonly();
  readonly stats: Signal<Stats>;
  readonly paused = this._paused.asReadonly();
  readonly silenced = this._silenced.asReadonly();

  // Newest pending values per entity, applied at the next publish.
  private readonly cpu: Float64Array;
  private readonly lat: Float64Array;
  private readonly rps: Float64Array;
  private readonly ts: Float64Array;
  private readonly status: Uint8Array;
  private readonly pending: Uint8Array;
  private readonly pendingIds: number[] = [];
  private queue: Tuple[] = [];
  private oldest = Infinity;
  private count = 0;
  private scheduled = false;

  private readonly feed: Alert[] = [];
  private readonly byId = new Map<number, Alert>();
  /** Every open alert, in the feed or not: alert id to entity id. */
  private readonly open = new Map<number, number>();
  private readonly counts: Stats;
  private readonly now: () => number;
  private readonly schedule: (cb: () => void) => void;

  constructor(
    fleet: readonly FleetMember[],
    opts: StoreOptions = {},
    readonly mode: Mode = 'batched',
  ) {
    this.list = fleet.map(newEntity);
    this._entities = signal<readonly Entity[]>(this.list);
    this.entities = this._entities.asReadonly();
    this.counts = emptyStats(fleet.length);
    this._stats = signal(structuredClone(this.counts));
    this.stats = this._stats.asReadonly();
    const n = fleet.length;
    this.cpu = new Float64Array(n);
    this.lat = new Float64Array(n);
    this.rps = new Float64Array(n);
    this.ts = new Float64Array(n);
    this.status = new Uint8Array(n);
    this.pending = new Uint8Array(n);
    this.now = opts.now ?? Date.now;
    this.schedule = opts.schedule ?? ((cb) => requestAnimationFrame(cb));
  }

  ingest(t: Tuple): void {
    const kind = t[0];
    const sent = t[t.length - 1];
    if (sent < this.oldest) this.oldest = sent;
    this.count++;
    if (kind === METRIC) {
      const id = t[1];
      if (id >= this.list.length) return;
      this.cpu[id] = t[2];
      this.lat[id] = t[3];
      this.rps[id] = t[4];
      this.ts[id] = sent;
      this.mark(id, PENDING_METRIC);
    } else if (kind === STATUS_CHANGE) {
      const id = t[1];
      if (id >= this.list.length) return;
      this.status[id] = t[2];
      this.mark(id, PENDING_STATUS);
    } else if (kind === ALERT || kind === RESOLVE) {
      this.queue.push(t);
    }
    if (!this.scheduled && !this._paused()) {
      this.scheduled = true;
      this.schedule(() => this.publish());
    }
  }

  private mark(id: number, bit: number): void {
    if (this.pending[id] === 0) this.pendingIds.push(id);
    this.pending[id] |= bit;
  }

  /** Applies everything pending. Runs once per frame; public for tests. */
  publish(): void {
    this.scheduled = false;
    if (this._paused() || this.count === 0) return;
    const list = this.list;
    const counts = this.counts.byStatus;
    for (const id of this.pendingIds) {
      const e = list[id];
      const bits = this.pending[id];
      if (bits & PENDING_METRIC) {
        e.cpu = this.cpu[id];
        e.lat = this.lat[id];
        e.rps = this.rps[id];
        e.updated = this.ts[id];
      }
      if (bits & PENDING_STATUS) {
        const s = STATUS[this.status[id]];
        if (s !== e.status) {
          counts[e.status]--;
          counts[s]++;
          e.status = s;
        }
      }
      this.pending[id] = 0;
    }
    this.pendingIds.length = 0;

    let feedChanged = false;
    if (this.queue.length) {
      const now = this.now();
      const silenced = this._silenced();
      for (const t of this.queue) feedChanged = this.applyAlert(t, now, silenced) || feedChanged;
      this.queue = [];
    }
    if (feedChanged) {
      if (this.feed.length > ALERT_CAP) for (const a of this.feed.splice(ALERT_CAP)) this.byId.delete(a.id);
      this._alerts.set(this.feed.slice());
    }
    this._stats.set({ ...this.counts, byStatus: { ...counts } });
    this._version.update((v) => v + 1);
    const oldest = this.oldest;
    const events = this.count;
    this.oldest = Infinity;
    this.count = 0;
    this.onPublish?.(oldest, events);
  }

  private applyAlert(t: Tuple, now: number, silenced: ReadonlyMap<number, number>): boolean {
    if (t[0] === ALERT) {
      const e = this.list[t[2]];
      if (!e) return false;
      e.alerts++;
      this.counts.openAlerts++;
      this.open.set(t[1], e.id);
      const until = silenced.get(e.id);
      if (until !== undefined && until > now) {
        this.counts.silencedAlerts++;
        return false;
      }
      const a = alertFrom(t, e);
      this.feed.unshift(a);
      this.byId.set(a.id, a);
      this.onAlert?.(a);
      return true;
    }
    // RESOLVE: the alert may have been silenced, or dropped from the feed already.
    const entityId = this.open.get(t[1]);
    if (entityId === undefined) return false;
    this.open.delete(t[1]);
    this.list[entityId].alerts--;
    this.counts.openAlerts--;
    const a = this.byId.get(t[1]);
    if (!a) return false;
    this.replace({ ...a, resolvedAt: t[t.length - 1] });
    return true;
  }

  private replace(a: Alert): void {
    const i = this.feed.findIndex((x) => x.id === a.id);
    if (i >= 0) this.feed[i] = a;
    this.byId.set(a.id, a);
  }

  setPaused(paused: boolean): void {
    this._paused.set(paused);
    if (!paused && this.count > 0 && !this.scheduled) {
      this.scheduled = true;
      this.schedule(() => this.publish());
    }
  }

  acknowledge(alertId: number): void {
    const a = this.byId.get(alertId);
    if (!a || a.acknowledged) return;
    this.replace({ ...a, acknowledged: true });
    this._alerts.set(this.feed.slice());
  }

  silence(entityId: number, until: number): void {
    const m = new Map(this._silenced());
    m.set(entityId, until);
    this._silenced.set(m);
  }

  unsilence(entityId: number): void {
    const m = new Map(this._silenced());
    m.delete(entityId);
    this._silenced.set(m);
  }
}

/**
 * The straightforward version: each event produces a new entity array (one
 * copy of every entity reference, one new object for the entity that
 * changed) and sets the signals. Correct, idiomatic-looking, and O(fleet)
 * per event.
 */
export class NaiveStore implements FleetStore {
  readonly mode = 'naive' as const;
  onPublish: FleetStore['onPublish'] = null;
  onAlert: FleetStore['onAlert'] = null;

  private work: readonly Entity[];
  private workAlerts: readonly Alert[] = [];
  private workStats: Stats;
  private open: ReadonlyMap<number, number> = new Map();
  private readonly _version = signal(0);
  private readonly _entities: WritableSignal<readonly Entity[]>;
  private readonly _alerts = signal<readonly Alert[]>([]);
  private readonly _stats: WritableSignal<Stats>;
  private readonly _paused = signal(false);
  private readonly _silenced = signal<ReadonlyMap<number, number>>(new Map());
  readonly version = this._version.asReadonly();
  readonly entities: Signal<readonly Entity[]>;
  readonly alerts = this._alerts.asReadonly();
  readonly stats: Signal<Stats>;
  readonly paused = this._paused.asReadonly();
  readonly silenced = this._silenced.asReadonly();
  private readonly now: () => number;

  constructor(fleet: readonly FleetMember[], opts: StoreOptions = {}) {
    this.work = fleet.map(newEntity);
    this._entities = signal(this.work);
    this.entities = this._entities.asReadonly();
    this.workStats = emptyStats(fleet.length);
    this._stats = signal(this.workStats);
    this.stats = this._stats.asReadonly();
    this.now = opts.now ?? Date.now;
  }

  ingest(t: Tuple): void {
    const kind = t[0];
    const sent = t[t.length - 1];
    if (kind === METRIC) {
      const [, id, cpu, lat, rps] = t;
      this.work = this.work.map((e) => (e.id === id ? { ...e, cpu, lat, rps, updated: sent } : e));
    } else if (kind === STATUS_CHANGE) {
      const [, id, s] = t;
      const old = this.work[id];
      if (old && old.status !== STATUS[s]) {
        const byStatus = { ...this.workStats.byStatus };
        byStatus[old.status]--;
        byStatus[STATUS[s]]++;
        this.workStats = { ...this.workStats, byStatus };
        this.work = this.work.map((e) => (e.id === id ? { ...e, status: STATUS[s] } : e));
      }
    } else if (kind === ALERT) {
      const e = this.work[t[2]];
      if (e) {
        this.work = this.work.map((x) => (x.id === e.id ? { ...x, alerts: x.alerts + 1 } : x));
        this.open = new Map(this.open).set(t[1], e.id);
        const until = this._silenced().get(e.id);
        if (until !== undefined && until > this.now()) {
          this.workStats = { ...this.workStats, openAlerts: this.workStats.openAlerts + 1, silencedAlerts: this.workStats.silencedAlerts + 1 };
        } else {
          const a = alertFrom(t, e);
          this.workAlerts = [a, ...this.workAlerts].slice(0, ALERT_CAP);
          this.workStats = { ...this.workStats, openAlerts: this.workStats.openAlerts + 1 };
          this.onAlert?.(a);
        }
      }
    } else if (kind === RESOLVE) {
      const entityId = this.open.get(t[1]);
      if (entityId !== undefined) {
        const open = new Map(this.open);
        open.delete(t[1]);
        this.open = open;
        this.work = this.work.map((x) => (x.id === entityId ? { ...x, alerts: x.alerts - 1 } : x));
        this.workStats = { ...this.workStats, openAlerts: this.workStats.openAlerts - 1 };
        this.workAlerts = this.workAlerts.map((x) => (x.id === t[1] ? { ...x, resolvedAt: sent } : x));
      }
    }
    if (!this._paused()) {
      this.flush();
      this.onPublish?.(sent, 1);
    }
  }

  private flush(): void {
    this._entities.set(this.work);
    this._alerts.set(this.workAlerts);
    this._stats.set(this.workStats);
    this._version.update((v) => v + 1);
  }

  setPaused(paused: boolean): void {
    this._paused.set(paused);
    if (!paused) this.flush();
  }

  acknowledge(alertId: number): void {
    this.workAlerts = this.workAlerts.map((x) => (x.id === alertId ? { ...x, acknowledged: true } : x));
    this._alerts.set(this.workAlerts);
  }

  silence(entityId: number, until: number): void {
    const m = new Map(this._silenced());
    m.set(entityId, until);
    this._silenced.set(m);
  }

  unsilence(entityId: number): void {
    const m = new Map(this._silenced());
    m.delete(entityId);
    this._silenced.set(m);
  }
}

export function createStore(mode: Mode, fleet: readonly FleetMember[], opts: StoreOptions = {}): FleetStore {
  if (mode === 'naive') return new NaiveStore(fleet, opts);
  if (mode === 'eager' || mode === 'zone') return new BatchedStore(fleet, { ...opts, schedule: (cb) => cb() }, mode);
  return new BatchedStore(fleet, opts);
}
