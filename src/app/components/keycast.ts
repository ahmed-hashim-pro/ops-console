import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

const NAMES: Record<string, string> = {
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowRight: '→',
  ' ': 'Space',
  Escape: 'Esc',
  PageDown: 'PgDn',
  PageUp: 'PgUp',
};

/** Shows the keys being pressed, for screen recordings (?demo). Hidden from assistive technology. */
@Component({
  selector: 'app-keycast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:keydown)': 'onKey($event)', 'aria-hidden': 'true' },
  template: `@if (text()) { <div class="keycast">{{ text() }}</div> }`,
})
export class Keycast {
  readonly text = signal('');
  private timer: ReturnType<typeof setTimeout> | null = null;

  onKey(ev: KeyboardEvent): void {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(ev.key)) return;
    const name = NAMES[ev.key] ?? (ev.key.length === 1 ? ev.key : ev.key);
    const combo = (ev.shiftKey && ev.key === 'Tab' ? 'Shift+' : '') + name;
    this.text.set(combo);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.text.set(''), 900);
  }
}
