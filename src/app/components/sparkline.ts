import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, input, viewChild } from '@angular/core';
import { ThemeService } from '../theme';

/** A line of the last two minutes, drawn on a canvas, with its numbers in text. */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="spark">
      <p aria-hidden="true">{{ caption() }}</p>
      <canvas #canvas role="img" [attr.aria-label]="summary()"></canvas>
    </div>
  `,
})
export class Sparkline {
  readonly label = input.required<string>();
  readonly unit = input.required<string>();
  readonly series = input.required<readonly number[]>();
  /** CSS custom property holding the line colour. */
  readonly color = input('--chart-cpu');
  /** Fixed top of the scale, or null to fit the data. */
  readonly max = input<number | null>(null);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly theme = inject(ThemeService);

  readonly stats = computed(() => sparkStats(this.series()));
  readonly caption = computed(() => {
    const s = this.stats();
    if (!s) return `${this.label()}: waiting for data`;
    return `${this.label()} ${fmt(s.now)} ${this.unit()} · 2 min range ${fmt(s.min)}–${fmt(s.max)}`;
  });
  readonly summary = computed(() => sparkSummary(this.label(), this.unit(), this.series()));

  constructor() {
    afterRenderEffect(() => {
      this.theme.theme();
      draw(this.canvas().nativeElement, this.series(), this.max(), this.color());
    });
  }
}

function fmt(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

export function sparkStats(series: readonly number[]): { min: number; max: number; now: number } | null {
  if (!series.length) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of series) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max, now: series[series.length - 1] };
}

/** The text alternative for the chart. */
export function sparkSummary(label: string, unit: string, series: readonly number[]): string {
  const s = sparkStats(series);
  if (!s) return `${label}: no samples yet`;
  const secs = series.length;
  return `${label} over the last ${secs} second${secs === 1 ? '' : 's'}: low ${fmt(s.min)} ${unit}, high ${fmt(s.max)} ${unit}, now ${fmt(s.now)} ${unit}`;
}

function draw(canvas: HTMLCanvasElement, series: readonly number[], fixedMax: number | null, colorVar: string): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const css = getComputedStyle(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = css.getPropertyValue('--chart-grid').trim() || '#ccc';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(w, h - 0.5);
  ctx.stroke();
  if (series.length < 2) return;
  const s = sparkStats(series)!;
  const top = fixedMax ?? (s.max > 0 ? s.max * 1.1 : 1);
  const step = w / 119; // 120 samples across the width; fewer start at the right
  const x0 = w - (series.length - 1) * step;
  ctx.strokeStyle = css.getPropertyValue(colorVar).trim() || '#0969da';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  series.forEach((v, i) => {
    const x = x0 + i * step;
    const y = h - 2 - (Math.min(v, top) / top) * (h - 4);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}
