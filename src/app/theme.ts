import { Injectable, effect, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the setting lasts for this page only */
  }
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(
    (stored('ops-console.theme') as Theme | null) ??
      (matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );
  /** Single-key shortcuts (WCAG 2.1.4: they can be turned off). */
  readonly shortcuts = signal(stored('ops-console.shortcuts') !== 'off');

  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.dataset['theme'] = t;
      store('ops-console.theme', t);
    });
    effect(() => store('ops-console.shortcuts', this.shortcuts() ? 'on' : 'off'));
  }

  toggle(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }
}
