import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Announcer } from '../announcer';
import { STORE } from '../config';
import { History } from '../history';
import { STATUS_LABEL } from '../model';
import { FleetView } from '../view';
import { Sparkline } from './sparkline';

export const SILENCE_MS = 15 * 60 * 1000;

export function clock(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, '0')).join(':');
}

@Component({
  selector: 'app-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Sparkline],
  template: `
    @if (entity(); as e) {
      <section class="panel detail" aria-labelledby="detail-h" (keydown.escape)="close()">
        <div class="panel-head">
          <h2 id="detail-h" tabindex="-1" #heading>{{ e.name }}</h2>
          <button type="button" (click)="close()">Close details</button>
        </div>
        <dl class="facts">
          <dt>Status</dt>
          <dd><span class="status" [attr.data-status]="e.status">{{ statusLabel[e.status] }}</span></dd>
          <dt>Region</dt>
          <dd>{{ e.region }}</dd>
          <dt>CPU</dt>
          <dd>{{ e.cpu | number: '1.1-1' }} %</dd>
          <dt>Kind</dt>
          <dd>{{ e.kind }}</dd>
          <dt>Latency</dt>
          <dd>{{ e.lat | number: '1.0-0' }} ms</dd>
          <dt>Req/s</dt>
          <dd>{{ e.rps | number: '1.0-0' }}</dd>
          <dt>Open alerts</dt>
          <dd>{{ e.alerts }}</dd>
          <dt>Updated</dt>
          <dd>{{ e.updated ? clock(e.updated) : 'not yet' }}</dd>
        </dl>
        <app-sparkline label="CPU" unit="%" [max]="100" [series]="cpu()" />
        <app-sparkline label="Latency" unit="ms" color="--chart-lat" [series]="lat()" />
        @if (silencedUntil(); as until) {
          <p>
            New alerts from this entity are silenced until {{ clock(until) }}.
            <button type="button" id="unsilence-entity" (click)="unsilence(e.id)">Unsilence</button>
          </p>
        } @else {
          <button type="button" id="silence-entity" (click)="silence(e.id)">Silence alerts for 15 minutes</button>
        }
      </section>
    }
  `,
})
export class Detail {
  private readonly store = inject(STORE);
  private readonly view = inject(FleetView);
  private readonly history = inject(History);
  private readonly announcer = inject(Announcer);
  private readonly injector = inject(Injector);
  readonly statusLabel = STATUS_LABEL;
  readonly clock = clock;
  /** Emitted with the entity id on close when the element that opened the panel is gone, so focus can go to its row. */
  readonly closed = output<number>();
  private readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('heading');
  /** What had focus when the panel opened; focus returns there on close. */
  private opener: HTMLElement | null = null;

  readonly entity = computed(() => {
    this.store.version();
    const id = this.view.selected();
    // A fresh object each time so the template sees changed values (the batched store mutates in place).
    return id === null ? null : { ...this.store.entities()[id] };
  });
  readonly cpu = computed(() => {
    this.history.version();
    const id = this.view.selected();
    return id === null ? [] : this.history.series('cpu', id);
  });
  readonly lat = computed(() => {
    this.history.version();
    const id = this.view.selected();
    return id === null ? [] : this.history.series('lat', id);
  });
  readonly silencedUntil = computed(() => {
    const id = this.view.selected();
    const until = id === null ? undefined : this.store.silenced().get(id);
    return until !== undefined && until > Date.now() ? until : null;
  });

  constructor() {
    // Move focus to the heading whenever a different entity is opened.
    effect(() => {
      const id = this.view.selected();
      if (id === null) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.id !== 'detail-h') this.opener = active;
      untracked(() =>
        afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector }),
      );
    });
  }

  close(): void {
    const id = this.view.selected();
    this.view.selected.set(null);
    const opener = this.opener;
    this.opener = null;
    if (opener?.isConnected) opener.focus();
    else if (id !== null) this.closed.emit(id);
  }

  silence(id: number): void {
    this.store.silence(id, Date.now() + SILENCE_MS);
    this.announcer.say(`Alerts from ${this.store.entities()[id].name} silenced for 15 minutes.`);
    this.focusAfterRender('unsilence-entity');
  }

  unsilence(id: number): void {
    this.store.unsilence(id);
    this.announcer.say(`Alerts from ${this.store.entities()[id].name} are no longer silenced.`);
    this.focusAfterRender('silence-entity');
  }

  /** The button just pressed is replaced by its opposite; keep focus there. */
  private focusAfterRender(id: string): void {
    afterNextRender(() => document.getElementById(id)?.focus(), { injector: this.injector });
  }
}
