import { Injectable, signal } from '@angular/core';
import { Alert } from './model';

export type AnnounceLevel = 'critical' | 'all' | 'off';

/** How often a summary of new alerts may be spoken. */
export const ALERT_SUMMARY_MS = 10000;

/**
 * Two polite live regions. `status` speaks the result of something the user
 * did, at once. `alerts` speaks a summary of new alerts at most once every
 * ten seconds, so a burst of fifty alerts is one sentence, not fifty.
 */
@Injectable({ providedIn: 'root' })
export class Announcer {
  readonly status = signal('');
  readonly alerts = signal('');
  readonly level = signal<AnnounceLevel>('critical');
  private critical: Alert[] = [];
  private warnings = 0;

  say(text: string): void {
    // Changing to the same text is not announced; clear first.
    this.status.set('');
    queueMicrotask(() => this.status.set(text));
  }

  noteAlert(a: Alert): void {
    if (a.severity === 'critical') this.critical.push(a);
    else this.warnings++;
  }

  /** Called every ALERT_SUMMARY_MS. Returns what it announced, for tests. */
  flush(): string {
    const level = this.level();
    const crit = this.critical;
    const warn = this.warnings;
    this.critical = [];
    this.warnings = 0;
    if (level === 'off') return '';
    const parts: string[] = [];
    if (crit.length === 1) parts.push(`1 new critical alert: ${crit[0].entityName}`);
    else if (crit.length > 1) parts.push(`${crit.length} new critical alerts, first ${crit[0].entityName}`);
    if (level === 'all' && warn) parts.push(`${warn} new warning${warn === 1 ? '' : 's'}`);
    const text = parts.join('. ');
    if (text) {
      this.alerts.set('');
      queueMicrotask(() => this.alerts.set(text + '.'));
    }
    return text;
  }
}
