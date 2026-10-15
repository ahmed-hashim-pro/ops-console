// Deterministic fleet and event generator. No dependencies, no clock: the
// sequence of events is a pure function of (seed, fleet size), so a test
// run, a perf run and the README demo all see the same stream. The server
// stamps the send time on each event; nothing here reads the time.

export const STATUS = ['ok', 'warn', 'crit', 'offline'];
export const REGIONS = ['eu-west', 'eu-central', 'us-east', 'us-west', 'ap-south', 'ap-east'];
export const KINDS = ['api', 'worker', 'edge', 'db', 'cache', 'queue'];

// Alert codes the client knows how to describe.
export const ALERT_CODES = ['cpu-high', 'latency-high', 'heartbeat-lost', 'error-rate', 'disk-full'];

// Event tuples, kept as arrays so 10,000 of them a second stay cheap to
// encode and parse:
//   [0, id, cpu, latencyMs, rps]          metric sample
//   [1, id, status]                       status change (index into STATUS)
//   [2, alertId, id, severity, code]      alert raised (severity 1 = warning, 2 = critical)
//   [3, alertId]                          alert resolved
export const METRIC = 0;
export const STATUS_CHANGE = 1;
export const ALERT = 2;
export const RESOLVE = 3;

// mulberry32: small, fast, good enough for synthetic data, and the same in
// every JavaScript engine.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createFleet(seed, n) {
  const r = rng(seed ^ 0x9e3779b9);
  const fleet = [];
  for (let id = 0; id < n; id++) {
    const region = REGIONS[Math.floor(r() * REGIONS.length)];
    const kind = KINDS[Math.floor(r() * KINDS.length)];
    fleet.push({ id, name: `${kind}-${region}-${String(id).padStart(4, '0')}`, region, kind });
  }
  return fleet;
}

// The stream keeps a little hidden state per entity (a baseline load and
// latency it drifts around) and runs occasional regional incidents, so the
// dashboard sees bursts of status changes and alerts rather than uniform
// noise.
export function createStream(seed, n) {
  const r = rng(seed);
  const fleet = createFleet(seed, n);
  const base = fleet.map(() => ({ cpu: 15 + r() * 45, lat: 8 + r() * 60 }));
  const status = new Uint8Array(n);
  const openAlert = new Int32Array(n).fill(-1);
  let nextAlertId = 1;
  let incident = null; // { region, left }
  let count = 0;

  function load(id) {
    const hot = incident && fleet[id].region === incident.region;
    const cpu = Math.min(100, Math.max(0, base[id].cpu + (r() - 0.5) * 20 + (hot ? 40 : 0)));
    const lat = Math.max(1, base[id].lat * (0.7 + r() * 0.6) * (hot ? 4 : 1));
    return { cpu, lat };
  }

  function next() {
    count++;
    if (!incident && r() < 0.000005) incident = { region: REGIONS[Math.floor(r() * REGIONS.length)], left: 40000 };
    if (incident && --incident.left <= 0) incident = null;

    const id = Math.floor(r() * n);
    const roll = r();
    if (roll < 0.004) {
      // Raise or resolve an alert on this entity.
      if (openAlert[id] >= 0) {
        const alertId = openAlert[id];
        openAlert[id] = -1;
        return [RESOLVE, alertId];
      }
      const { cpu, lat } = load(id);
      // Alerts come from trouble, plus a little noise; an open alert is
      // resolved the next time this branch picks its entity, so about 6% of
      // the fleet has one open at a time outside incidents.
      const trouble = cpu > 85 || lat > 200 || status[id] >= 2;
      if (!trouble && r() >= 0.03) return [METRIC, id, Math.round(cpu * 10) / 10, Math.round(lat * 10) / 10, Math.round(50 + r() * 950)];
      const critical = cpu > 90 || lat > 250 || status[id] >= 2;
      const code = cpu > 85 ? 0 : lat > 200 ? 1 : Math.floor(r() * ALERT_CODES.length);
      const alertId = nextAlertId++;
      openAlert[id] = alertId;
      return [ALERT, alertId, id, critical ? 2 : 1, code];
    }
    // Status changes are rare (an entity changes about once a minute and a
    // half at 10,000 events/s over 5,000 entities), except in a region
    // having an incident.
    const hot = incident && fleet[id].region === incident.region;
    if (roll < (hot ? 0.034 : 0.01)) {
      const p = r();
      const s = hot ? (p < 0.5 ? 2 : p < 0.6 ? 3 : 1) : p < 0.88 ? 0 : p < 0.97 ? 1 : p < 0.995 ? 2 : 3;
      status[id] = s;
      return [STATUS_CHANGE, id, s];
    }
    const { cpu, lat } = load(id);
    return [METRIC, id, Math.round(cpu * 10) / 10, Math.round(lat * 10) / 10, Math.round(50 + r() * 950)];
  }

  return {
    fleet,
    next,
    get count() {
      return count;
    },
  };
}
