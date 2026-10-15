import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Announcer } from '../announcer';
import { STORE } from '../config';
import { ALERT_TEXT, Alert } from '../model';
import { SILENCE_MS, clock } from './detail';

/** How many alerts the feed renders. */
export const FEED_SHOWN = 50;

/**
 * The newest alerts. While focus is inside the list, the list holds still:
 * new alerts are counted behind a "Show N new alerts" button instead of
 * pushing the focused item down.
 */
@Component({
  selector: 'app-alert-feed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel feed" aria-labelledby="alerts-h">
      <div class="panel-head">
        <h2 id="alerts-h">Alerts</h2>
        <span class="done">{{ store.stats().silencedAlerts }} silenced</span>
      </div>
      <div class="feed-controls">
        <label><input type="checkbox" [checked]="hideAcknowledged()" (change)="hideAcknowledged.set(!hideAcknowledged())" /> Hide acknowledged</label>
        <span class="announce">
          <label for="announce">Announce</label>
          <select id="announce" #announce [value]="announcer.level()" (change)="announcer.level.set($any(announce.value))">
            <option value="critical">Critical alerts</option>
            <option value="all">All alerts</option>
            <option value="off">Nothing</option>
          </select>
        </span>
      </div>
      @if (held() && waiting() > 0) {
        <button type="button" class="new-alerts" (click)="showNew()">Show {{ waiting() }} new alert{{ waiting() === 1 ? '' : 's' }}</button>
      }
      <ul #list class="alerts" aria-labelledby="alerts-h" (focusin)="hold()" (focusout)="onFocusOut($event)">
        @for (a of shown(); track a.id) {
          <li [attr.data-severity]="a.severity">
            <p class="a-line">
              <span class="sev">{{ a.severity === 'critical' ? 'Critical' : 'Warning' }}</span>
              <button type="button" class="link" (click)="openEntity.emit(a.entityId)">{{ a.entityName }}</button>
            </p>
            <p class="a-text">
              {{ text[a.code] }} · raised <time>{{ clock(a.raisedAt) }}</time>
              @if (a.resolvedAt) { · resolved <time>{{ clock(a.resolvedAt) }}</time> }
            </p>
            <div class="a-actions">
              @if (a.acknowledged) {
                <span class="done">Acknowledged</span>
              } @else {
                <button type="button" [attr.aria-label]="'Acknowledge: ' + a.severity + ' alert on ' + a.entityName" (click)="ack(a)">Acknowledge</button>
              }
              <button type="button" [id]="'silence-' + a.id" [attr.aria-label]="'Silence 15 min: ' + a.entityName" (click)="silence(a)">Silence 15 min</button>
            </div>
          </li>
        } @empty {
          <li class="done">No alerts yet.</li>
        }
      </ul>
    </section>
  `,
})
export class AlertFeed {
  readonly store = inject(STORE);
  readonly announcer = inject(Announcer);
  private readonly injector = inject(Injector);
  readonly text = ALERT_TEXT;
  readonly clock = clock;
  readonly openEntity = output<number>();
  private readonly list = viewChild.required<ElementRef<HTMLUListElement>>('list');

  readonly hideAcknowledged = signal(false);
  /** Ids on screen while held; null when live. */
  private readonly heldIds = signal<readonly number[] | null>(null);
  readonly held = computed(() => this.heldIds() !== null);

  private readonly visible = computed(() => {
    const hide = this.hideAcknowledged();
    const out: Alert[] = [];
    for (const a of this.store.alerts()) {
      if (hide && a.acknowledged) continue;
      out.push(a);
      if (out.length === FEED_SHOWN) break;
    }
    return out;
  });

  readonly shown = computed<readonly Alert[]>(() => {
    const ids = this.heldIds();
    if (ids === null) return this.visible();
    const byId = new Map(this.store.alerts().map((a) => [a.id, a]));
    return ids.map((id) => byId.get(id)).filter((a): a is Alert => !!a);
  });

  /** New alerts waiting behind the held list. */
  readonly waiting = computed(() => {
    const ids = this.heldIds();
    if (ids === null) return 0;
    const newest = ids.length ? Math.max(...ids) : 0;
    let n = 0;
    for (const a of this.store.alerts()) if (a.id > newest) n++;
    return n;
  });

  hold(): void {
    if (this.heldIds() === null) this.heldIds.set(this.visible().map((a) => a.id));
  }

  onFocusOut(ev: FocusEvent): void {
    const to = ev.relatedTarget as Node | null;
    if (!to || !this.list().nativeElement.contains(to)) this.heldIds.set(null);
  }

  showNew(): void {
    this.heldIds.set(null);
    this.list().nativeElement.querySelector<HTMLButtonElement>('button')?.focus();
  }

  ack(a: Alert): void {
    this.store.acknowledge(a.id);
    this.announcer.say(`Acknowledged ${a.severity} alert on ${a.entityName}.`);
    // The button just pressed is gone; keep focus in the same item.
    afterNextRender(() => document.getElementById(`silence-${a.id}`)?.focus(), { injector: this.injector });
  }

  silence(a: Alert): void {
    this.store.silence(a.entityId, Date.now() + SILENCE_MS);
    this.announcer.say(`Alerts from ${a.entityName} silenced for 15 minutes.`);
  }
}
