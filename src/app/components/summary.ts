import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { STORE } from '../config';
import { STATUS, STATUS_LABEL } from '../model';
import { Telemetry } from '../telemetry';
import { Sparkline } from './sparkline';

@Component({
  selector: 'app-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Sparkline],
  template: `
    <h2 class="visually-hidden">Summary</h2>
    <dl class="summary">
      @for (s of statuses; track s) {
        <div class="tile">
          <dt><span class="status" [attr.data-status]="s">{{ label[s] }}</span></dt>
          <dd [attr.data-testid]="'count-' + s">{{ stats().byStatus[s] | number }}</dd>
        </div>
      }
      <div class="tile">
        <dt>Open alerts</dt>
        <dd data-testid="open-alerts">{{ stats().openAlerts | number }}</dd>
      </div>
      <div class="tile">
        <dt>Data age (p95, 5 s)</dt>
        <dd data-testid="data-age">{{ ageText() }}</dd>
      </div>
      <div class="tile wide">
        <dt>Events per second</dt>
        <dd>
          <span data-testid="events-per-sec">{{ telemetry.eventsPerSec() | number }}</span>
          <app-sparkline label="Last 2 minutes:" unit="events/s" color="--chart-lat" [series]="telemetry.throughput()" />
        </dd>
      </div>
    </dl>
  `,
})
export class Summary {
  private readonly store = inject(STORE);
  readonly telemetry = inject(Telemetry);
  readonly statuses = STATUS;
  readonly label = STATUS_LABEL;
  readonly stats = this.store.stats;
  readonly ageText = computed(() => {
    const ms = this.telemetry.staleP95();
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
  });
}
