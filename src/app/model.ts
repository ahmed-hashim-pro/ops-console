// Shared types and the wire format. The constants mirror server/generator.mjs;
// model.spec.ts checks they still agree.

export const STATUS = ['ok', 'warn', 'crit', 'offline'] as const;
export type Status = (typeof STATUS)[number];
export const STATUS_LABEL: Record<Status, string> = {
  ok: 'OK',
  warn: 'Warning',
  crit: 'Critical',
  offline: 'Offline',
};
/** Higher is worse; used by the severity sort. */
export const STATUS_RANK: Record<Status, number> = { ok: 0, warn: 1, offline: 2, crit: 3 };

export const REGIONS = ['eu-west', 'eu-central', 'us-east', 'us-west', 'ap-south', 'ap-east'] as const;
export const KINDS = ['api', 'worker', 'edge', 'db', 'cache', 'queue'] as const;
export const ALERT_CODES = ['cpu-high', 'latency-high', 'heartbeat-lost', 'error-rate', 'disk-full'] as const;
export const ALERT_TEXT: Record<(typeof ALERT_CODES)[number], string> = {
  'cpu-high': 'CPU above threshold',
  'latency-high': 'Latency above threshold',
  'heartbeat-lost': 'Heartbeat lost',
  'error-rate': 'Error rate rising',
  'disk-full': 'Disk nearly full',
};

export const METRIC = 0;
export const STATUS_CHANGE = 1;
export const ALERT = 2;
export const RESOLVE = 3;

/** One event as it arrives: see server/generator.mjs. The last element is the send time (ms since epoch). */
export type Tuple = number[];

export interface FleetMember {
  id: number;
  name: string;
  region: string;
  kind: string;
}

export interface Entity extends FleetMember {
  status: Status;
  cpu: number;
  lat: number;
  rps: number;
  /** Open alerts raised on this entity. */
  alerts: number;
  /** Send time of the newest event applied. */
  updated: number;
}

export type Severity = 'warning' | 'critical';

export interface Alert {
  id: number;
  entityId: number;
  entityName: string;
  severity: Severity;
  code: (typeof ALERT_CODES)[number];
  raisedAt: number;
  resolvedAt: number | null;
  acknowledged: boolean;
}

export interface Stats {
  byStatus: Record<Status, number>;
  openAlerts: number;
  silencedAlerts: number;
}

export function newEntity(m: FleetMember): Entity {
  return { ...m, status: 'ok', cpu: 0, lat: 0, rps: 0, alerts: 0, updated: 0 };
}

export function emptyStats(n: number): Stats {
  return { byStatus: { ok: n, warn: 0, crit: 0, offline: 0 }, openAlerts: 0, silencedAlerts: 0 };
}
