import { ChangeDetectionStrategy, Component, DestroyRef, afterEveryRender, computed, inject, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ALERT_SUMMARY_MS, Announcer } from './announcer';
import { AlertFeed } from './components/alert-feed';
import { Detail } from './components/detail';
import { Filters } from './components/filters';
import { FleetTable } from './components/fleet-table';
import { Keycast } from './components/keycast';
import { Shortcuts } from './components/shortcuts';
import { Summary } from './components/summary';
import { CONFIG, STORE } from './config';
import { History } from './history';
import { Stream } from './stream';
import { Telemetry } from './telemetry';
import { ThemeService } from './theme';
import { FleetView, REORDER_MS } from './view';
import { MODE_LABEL } from './store';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Summary, Filters, FleetTable, Detail, AlertFeed, Shortcuts, Keycast],
  host: { '(window:keydown)': 'onKey($event)' },
  template: `
    <a class="skip" href="#fleet-h" (click)="skipToTable($event)">Skip to the fleet table</a>
    <header class="bar">
      <h1>Ops console</h1>
      <p class="meta">
        <span class="conn" [attr.data-state]="stream.connection()" data-testid="connection">{{ connectionText() }}</span>
        @if (store.paused()) {
          <span class="paused-chip" data-testid="paused">Paused</span>
        }
      </p>
      <div class="actions">
        <button type="button" [attr.aria-pressed]="store.paused()" (click)="togglePause()" data-testid="pause">Pause updates</button>
        <button type="button" [attr.aria-pressed]="theme.theme() === 'dark'" (click)="theme.toggle()">Dark theme</button>
        <button type="button" aria-haspopup="dialog" (click)="help().open()">Keyboard shortcuts</button>
      </div>
    </header>
    <app-summary />
    <div class="layout">
      <main class="main">
        <app-filters />
        <app-fleet-table />
      </main>
      <aside class="side" aria-label="Details and alerts">
        @if (view.selected() !== null) {
          <app-detail (closed)="table().focusEntity($event)" />
        }
        <app-alert-feed (openEntity)="openEntity($event)" />
      </aside>
    </div>
    <footer>
      {{ modeLabel[config.mode] }} · {{ config.rate | number }} events/s requested ·
      {{ config.n | number }} entities · seed {{ config.seed }}
    </footer>
    <div class="visually-hidden" role="status" aria-live="polite" data-testid="status-live">{{ announcer.status() }}</div>
    <div class="visually-hidden" aria-live="polite" data-testid="alerts-live">{{ announcer.alerts() }}</div>
    <app-shortcuts />
    @if (config.demo) {
      <app-keycast />
    }
  `,
})
export class App {
  readonly config = inject(CONFIG);
  readonly store = inject(STORE);
  readonly stream = inject(Stream);
  readonly view = inject(FleetView);
  readonly announcer = inject(Announcer);
  readonly theme = inject(ThemeService);
  private readonly telemetry = inject(Telemetry);
  private readonly history = inject(History);

  readonly modeLabel = MODE_LABEL;
  readonly table = viewChild.required(FleetTable);
  readonly filters = viewChild.required(Filters);
  readonly help = viewChild.required(Shortcuts);

  readonly connectionText = computed(() => {
    switch (this.stream.connection()) {
      case 'live':
        return 'Live';
      case 'connecting':
        return 'Connecting';
      case 'reconnecting':
        return 'Reconnecting';
    }
  });

  constructor() {
    const store = this.store;
    store.onPublish = (oldest) => this.telemetry.published(oldest);
    this.telemetry.start();
    store.onAlert = (a) => this.announcer.noteAlert(a);
    const perf = window.__perf;
    if (this.config.perf && perf) {
      this.telemetry.sink = (stale) => perf.stale.push(stale);
      perf.received = () => this.telemetry.received;
      afterEveryRender(() => perf.renders++);
    }

    const timers = [
      setInterval(() => {
        this.telemetry.tick();
        this.history.sample();
      }, 1000),
      setInterval(() => this.announcer.flush(), ALERT_SUMMARY_MS),
    ];
    timers.push(
      setInterval(() => {
        if (!store.paused()) this.view.tick.update((t) => t + 1);
      }, REORDER_MS),
    );
    this.stream.start();
    inject(DestroyRef).onDestroy(() => {
      timers.forEach(clearInterval);
      this.telemetry.stop();
      this.stream.stop();
    });
  }

  togglePause(): void {
    const paused = !this.store.paused();
    this.store.setPaused(paused);
    this.announcer.say(paused ? 'Updates paused.' : 'Updates resumed.');
  }

  openEntity(id: number): void {
    this.view.selected.set(id);
  }

  skipToTable(ev: Event): void {
    ev.preventDefault();
    this.table().focusEntity(null);
  }

  /** Single-key shortcuts, ignored while typing and when turned off (WCAG 2.1.4). */
  onKey(ev: KeyboardEvent): void {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.defaultPrevented) return;
    if (!this.theme.shortcuts()) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.closest('input, select, textarea, [contenteditable]') || t.closest('dialog'))) return;
    switch (ev.key) {
      case '/':
        ev.preventDefault();
        this.filters().focusSearch();
        break;
      case 'p':
        ev.preventDefault();
        this.togglePause();
        break;
      case '?':
        ev.preventDefault();
        this.help().open();
        break;
    }
  }
}
