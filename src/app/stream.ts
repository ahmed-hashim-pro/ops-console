import { Injectable, inject, signal } from '@angular/core';
import { CONFIG, STORE } from './config';
import { Telemetry } from './telemetry';

export type Connection = 'connecting' | 'live' | 'reconnecting';

/**
 * Reads the server's event stream into the store. Parsing happens here,
 * per message, the same for both stores; what they do with each event is
 * what differs.
 */
@Injectable({ providedIn: 'root' })
export class Stream {
  private readonly config = inject(CONFIG);
  private readonly store = inject(STORE);
  private readonly telemetry = inject(Telemetry);
  readonly connection = signal<Connection>('connecting');
  private source: EventSource | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    this.open();
  }

  stop(): void {
    this.source?.close();
    this.source = null;
    if (this.retry) clearTimeout(this.retry);
  }

  private open(): void {
    const { seed, n, rate } = this.config;
    const from = this.telemetry.received;
    const es = new EventSource(`/events?seed=${seed}&n=${n}&rate=${rate}&from=${from}`);
    this.source = es;
    const store = this.store;
    const telemetry = this.telemetry;
    es.addEventListener('hello', () => this.connection.set('live'));
    // addEventListener, not onmessage: zone.js (in the zone build) tracks
    // the former and not the latter, and a zone app would normally use it.
    es.addEventListener('message', (m: MessageEvent<string>) => {
      telemetry.received++;
      store.ingest(JSON.parse(m.data));
    });
    // EventSource would reconnect by itself, but to the same URL, which would
    // restart the sequence. Reconnect with the count we have instead.
    es.onerror = () => {
      es.close();
      if (this.source !== es) return;
      this.connection.set('reconnecting');
      this.retry = setTimeout(() => this.open(), 1000);
    };
  }
}
