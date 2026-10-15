import { createStream } from '../../server/generator.mjs';
import { ALERT, METRIC, RESOLVE, STATUS_CHANGE, Tuple } from './model';
import { ALERT_CAP, BatchedStore, FleetStore, Mode, NaiveStore, createStore } from './store';

const fleet = [
  { id: 0, name: 'api-eu-west-0000', region: 'eu-west', kind: 'api' },
  { id: 1, name: 'db-us-east-0001', region: 'us-east', kind: 'db' },
  { id: 2, name: 'edge-ap-east-0002', region: 'ap-east', kind: 'edge' },
];

/** A store whose publishes run when the test says. */
function manual() {
  const queue: (() => void)[] = [];
  const store = new BatchedStore(fleet, { now: () => 1000, schedule: (cb) => queue.push(cb) });
  const frame = () => queue.splice(0).forEach((cb) => cb());
  return { store, frame, queue };
}

const t = (...xs: number[]): Tuple => [...xs, 500];

describe('BatchedStore', () => {
  it('folds any number of events into one update per frame', () => {
    const { store, frame, queue } = manual();
    for (let i = 0; i < 1000; i++) store.ingest(t(METRIC, i % 3, i % 100, 10, 50));
    expect(queue.length).toBe(1);
    expect(store.version()).toBe(0);
    expect(store.entities()[0].cpu).toBe(0);
    frame();
    expect(store.version()).toBe(1);
    // The newest value per entity wins.
    expect(store.entities()[0].cpu).toBe(99);
    expect(store.entities()[1].cpu).toBe(97);
    expect(store.entities()[2].cpu).toBe(98);
  });

  it('keeps status counts as statuses change', () => {
    const { store, frame } = manual();
    store.ingest(t(STATUS_CHANGE, 0, 2));
    store.ingest(t(STATUS_CHANGE, 1, 1));
    store.ingest(t(STATUS_CHANGE, 1, 3));
    frame();
    expect(store.stats().byStatus).toEqual({ ok: 1, warn: 0, crit: 1, offline: 1 });
    expect(store.entities()[1].status).toBe('offline');
  });

  it('raises, acknowledges and resolves alerts', () => {
    const { store, frame } = manual();
    const seen: number[] = [];
    store.onAlert = (a) => seen.push(a.id);
    store.ingest(t(ALERT, 7, 1, 2, 2));
    frame();
    expect(seen).toEqual([7]);
    expect(store.alerts()[0]).toMatchObject({ id: 7, entityId: 1, severity: 'critical', code: 'heartbeat-lost', resolvedAt: null });
    expect(store.entities()[1].alerts).toBe(1);
    expect(store.stats().openAlerts).toBe(1);
    store.acknowledge(7);
    expect(store.alerts()[0].acknowledged).toBe(true);
    store.ingest(t(RESOLVE, 7));
    frame();
    expect(store.alerts()[0].resolvedAt).toBe(500);
    expect(store.entities()[1].alerts).toBe(0);
    expect(store.stats().openAlerts).toBe(0);
  });

  it('keeps silenced alerts out of the feed but still counts and resolves them', () => {
    const { store, frame } = manual();
    store.silence(2, 5000);
    store.ingest(t(ALERT, 9, 2, 1, 0));
    frame();
    expect(store.alerts()).toEqual([]);
    expect(store.stats()).toMatchObject({ openAlerts: 1, silencedAlerts: 1 });
    expect(store.entities()[2].alerts).toBe(1);
    store.ingest(t(RESOLVE, 9));
    frame();
    expect(store.stats().openAlerts).toBe(0);
    expect(store.entities()[2].alerts).toBe(0);
  });

  it('stops publishing while paused and catches up on resume', () => {
    const { store, frame } = manual();
    store.setPaused(true);
    store.ingest(t(METRIC, 0, 42, 1, 1));
    frame();
    expect(store.version()).toBe(0);
    expect(store.entities()[0].cpu).toBe(0);
    store.setPaused(false);
    frame();
    expect(store.entities()[0].cpu).toBe(42);
  });

  it(`keeps at most ${ALERT_CAP} alerts`, () => {
    const { store, frame } = manual();
    for (let i = 1; i <= ALERT_CAP + 50; i++) store.ingest(t(ALERT, i, i % 3, 1, 0));
    frame();
    expect(store.alerts().length).toBe(ALERT_CAP);
    expect(store.alerts()[0].id).toBe(ALERT_CAP + 50);
  });
});

describe('NaiveStore', () => {
  it('publishes after every event', () => {
    const store = new NaiveStore(fleet);
    store.ingest(t(METRIC, 0, 1, 1, 1));
    store.ingest(t(METRIC, 0, 2, 1, 1));
    expect(store.version()).toBe(2);
    expect(store.entities()[0].cpu).toBe(2);
  });

  it('replaces the list and the changed entity, keeping the others', () => {
    const store = new NaiveStore(fleet);
    const before = store.entities();
    store.ingest(t(METRIC, 1, 5, 1, 1));
    const after = store.entities();
    expect(after).not.toBe(before);
    expect(after[1]).not.toBe(before[1]);
    expect(after[0]).toBe(before[0]);
  });
});

/** Everything the screen shows, without object identity. */
function view(s: FleetStore) {
  return {
    entities: s.entities().map((e) => ({ ...e })),
    stats: s.stats(),
    alerts: s.alerts().map((a) => ({ ...a })),
  };
}

describe('all stores', () => {
  it('end in the same state on the same 30,000 generated events', () => {
    const n = 200;
    const gen = createStream(7, n);
    const events: Tuple[] = [];
    for (let i = 0; i < 30000; i++) events.push([...gen.next(), 1000 + i]);
    const results = (['batched', 'eager', 'naive'] as Mode[]).map((mode) => {
      const pending: (() => void)[] = [];
      const store = createStore(mode, gen.fleet, { now: () => 0, schedule: (cb) => pending.push(cb) });
      store.silence(3, 1); // already expired: silences nothing
      events.forEach((e, i) => {
        store.ingest(e);
        if (i % 97 === 0) pending.splice(0).forEach((cb) => cb()); // frames at arbitrary points
        if (i === 20000) {
          pending.splice(0).forEach((cb) => cb());
          store.acknowledge(5);
        }
      });
      pending.splice(0).forEach((cb) => cb());
      return view(store);
    });
    expect(results[0].alerts.length).toBeGreaterThan(10);
    expect(results[0].alerts.find((a) => a.id === 5)?.acknowledged).toBe(true);
    expect(results[0].stats.openAlerts).toBeGreaterThan(0);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });
});
