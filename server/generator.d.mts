export declare const STATUS: readonly string[];
export declare const REGIONS: readonly string[];
export declare const KINDS: readonly string[];
export declare const ALERT_CODES: readonly string[];
export declare const METRIC: 0;
export declare const STATUS_CHANGE: 1;
export declare const ALERT: 2;
export declare const RESOLVE: 3;
export interface FleetMember {
  id: number;
  name: string;
  region: string;
  kind: string;
}
export declare function rng(seed: number): () => number;
export declare function createFleet(seed: number, n: number): FleetMember[];
export declare function createStream(
  seed: number,
  n: number,
): { fleet: FleetMember[]; next(): number[]; readonly count: number };
