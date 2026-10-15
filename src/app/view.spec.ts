import { TestBed } from '@angular/core/testing';
import { CONFIG, DEFAULTS, STORE } from './config';
import { Entity, STATUS, newEntity } from './model';
import { BatchedStore } from './store';
import { FleetView, orderIds } from './view';

function e(id: number, name: string, over: Partial<Entity> = {}): Entity {
  return { ...newEntity({ id, name, region: 'eu-west', kind: 'api' }), ...over };
}

const all = new Set(STATUS);

describe('orderIds', () => {
  const list = [
    e(0, 'api-eu-west-0000', { status: 'ok', cpu: 10, lat: 50 }),
    e(1, 'db-us-east-0001', { status: 'crit', cpu: 5, lat: 10, region: 'us-east' }),
    e(2, 'edge-eu-west-0002', { status: 'warn', cpu: 90, lat: 20, alerts: 2 }),
    e(3, 'api-eu-west-0003', { status: 'warn', cpu: 30, lat: 300, alerts: 0 }),
    e(4, 'cache-eu-west-0004', { status: 'offline', cpu: 0, lat: 5 }),
  ];
  const f = { query: '', statuses: all, region: 'all', sort: 'severity' as const };

  it('sorts by severity: critical, offline, warning, ok; then alerts, then CPU', () => {
    expect(orderIds(list, f)).toEqual([1, 4, 2, 3, 0]);
  });
  it('sorts by CPU, latency and name', () => {
    expect(orderIds(list, { ...f, sort: 'cpu' })).toEqual([2, 3, 0, 1, 4]);
    expect(orderIds(list, { ...f, sort: 'lat' })).toEqual([3, 0, 2, 1, 4]);
    expect(orderIds(list, { ...f, sort: 'name' })).toEqual([0, 3, 4, 1, 2]);
  });
  it('filters by name, status and region together', () => {
    expect(orderIds(list, { ...f, query: 'EU-WEST' })).toEqual([4, 2, 3, 0]);
    expect(orderIds(list, { ...f, statuses: new Set(['warn' as const]) })).toEqual([2, 3]);
    expect(orderIds(list, { ...f, region: 'us-east' })).toEqual([1]);
    expect(orderIds(list, { ...f, query: '0003', statuses: new Set(['warn' as const]) })).toEqual([3]);
    expect(orderIds(list, { ...f, statuses: new Set() })).toEqual([]);
  });
});

describe('FleetView', () => {
  function setup() {
    const fleet = [0, 1, 2].map((id) => ({ id, name: `api-eu-west-000${id}`, region: 'eu-west', kind: 'api' }));
    const frames: (() => void)[] = [];
    const store = new BatchedStore(fleet, { schedule: (cb) => frames.push(cb) });
    TestBed.configureTestingModule({
      providers: [
        { provide: CONFIG, useValue: DEFAULTS },
        { provide: STORE, useValue: store },
      ],
    });
    const view = TestBed.inject(FleetView);
    const frame = () => frames.splice(0).forEach((cb) => cb());
    return { store, view, frame };
  }

  it('re-orders on the tick, not on every change', () => {
    const { store, view, frame } = setup();
    view.sort.set('cpu');
    expect(view.rows()).toEqual([0, 1, 2]);
    store.ingest([0, 2, 99, 1, 1, 0]);
    frame();
    expect(view.rows()).toEqual([0, 1, 2]);
    view.tick.update((x) => x + 1);
    expect(view.rows()).toEqual([2, 0, 1]);
  });

  it('holds the order while frozen, but still applies a new filter', () => {
    const { store, view, frame } = setup();
    view.sort.set('cpu');
    view.frozen.set(true);
    expect(view.rows()).toEqual([0, 1, 2]);
    store.ingest([0, 1, 50, 1, 1, 0]);
    frame();
    view.tick.update((x) => x + 1);
    expect(view.rows()).toEqual([0, 1, 2]);
    view.query.set('0001');
    expect(view.rows()).toEqual([1]);
    view.frozen.set(false);
    view.query.set('');
    expect(view.rows()).toEqual([1, 0, 2]);
  });
});
