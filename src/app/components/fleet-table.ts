import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { STORE } from '../config';
import { STATUS_LABEL } from '../model';
import { FleetView, SORT_LABEL } from '../view';

export const ROW_HEIGHT = 36;
export const HEAD_HEIGHT = 40;
const OVERSCAN = 6;

/** Where the keyboard goes from row `i` of `n`, for a key; null for keys the table ignores. */
export function nextRow(key: string, i: number, n: number, page: number): number | null {
  if (n === 0) return null;
  let j: number;
  switch (key) {
    case 'ArrowDown':
      j = i + 1;
      break;
    case 'ArrowUp':
      j = i - 1;
      break;
    case 'PageDown':
      j = i + page;
      break;
    case 'PageUp':
      j = i - page;
      break;
    case 'Home':
      j = 0;
      break;
    case 'End':
      j = n - 1;
      break;
    default:
      return null;
  }
  return Math.min(n - 1, Math.max(0, j));
}

/**
 * A real <table>, virtualised: only the rows in view (plus a few either side)
 * exist in the DOM, with spacer rows above and below holding the scroll
 * height. aria-rowcount and aria-rowindex tell assistive technology where a
 * row sits in the whole list.
 *
 * Keyboard: one row's name button is in the tab order (roving tabindex);
 * arrows, Page Up/Down, Home and End move between rows, scrolling as needed;
 * Enter opens the row's details. While focus is in the table the order is
 * frozen so rows don't move under the user.
 */
@Component({
  selector: 'app-fleet-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel table-panel" aria-labelledby="fleet-h">
      <h2 id="fleet-h" class="visually-hidden">Fleet</h2>
      <div #scroller class="scroller" tabindex="-1" (scroll)="onScroll()" (focusin)="view.frozen.set(true)" (focusout)="onFocusOut($event)">
        <table class="fleet" [attr.aria-rowcount]="rows().length + 1" aria-describedby="fleet-note">
          <caption class="visually-hidden">
            Fleet, {{ rows().length }} entities, sorted by {{ sortLabel[view.sort()] }}. Use the arrow keys, Page Up, Page
            Down, Home and End to move between rows, and Enter to open a row's details.
          </caption>
          <colgroup>
            <col style="width: 28%" />
            <col style="width: 11%" />
            <col style="width: 9%" />
            <col style="width: 14%" />
            <col style="width: 9%" />
            <col style="width: 11%" />
            <col style="width: 9%" />
            <col style="width: 9%" />
          </colgroup>
          <thead>
            <tr aria-rowindex="1">
              <th scope="col">Name</th>
              <th scope="col">Region</th>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
              <th scope="col" class="num">CPU %</th>
              <th scope="col" class="num">Latency ms</th>
              <th scope="col" class="num">Req/s</th>
              <th scope="col" class="num">Alerts</th>
            </tr>
          </thead>
          <tbody (keydown)="onKey($event)">
            @if (start() > 0) {
              <tr class="pad" aria-hidden="true" [style.height.px]="start() * rowHeight"><td colspan="8"></td></tr>
            }
            @for (id of slice(); track id; let i = $index) {
              @let e = entities()[id];
              @let index = start() + i;
              <tr [attr.aria-rowindex]="index + 2" [class.selected]="view.selected() === id">
                <th scope="row">
                  <button
                    type="button"
                    class="open"
                    [id]="'row-' + id"
                    [attr.tabindex]="index === tabbable() ? 0 : -1"
                    [attr.aria-current]="view.selected() === id ? 'true' : null"
                    (focus)="active.set(index)"
                    (click)="open(id, index)"
                  >
                    {{ e.name }}
                  </button>
                </th>
                <td>{{ e.region }}</td>
                <td>{{ e.kind }}</td>
                <td><span class="status" [attr.data-status]="e.status">{{ statusLabel[e.status] }}</span></td>
                <td class="num">{{ e.cpu.toFixed(1) }}</td>
                <td class="num">{{ e.lat.toFixed(0) }}</td>
                <td class="num">{{ e.rps.toFixed(0) }}</td>
                <td class="num">{{ e.alerts }}</td>
              </tr>
            } @empty {
              <tr><td colspan="8">No entities match these filters.</td></tr>
            }
            @if (end() < rows().length) {
              <tr class="pad" aria-hidden="true" [style.height.px]="(rows().length - end()) * rowHeight"><td colspan="8"></td></tr>
            }
          </tbody>
        </table>
      </div>
      <p id="fleet-note" class="table-note">
        @if (view.frozen()) {
          Row order is held while you are in the table; values keep updating.
        } @else if (store.paused()) {
          Updates are paused.
        } @else {
          Rows re-sort every second.
        }
      </p>
    </section>
  `,
})
export class FleetTable {
  readonly store = inject(STORE);
  readonly view = inject(FleetView);
  private readonly injector = inject(Injector);
  readonly rowHeight = ROW_HEIGHT;
  readonly statusLabel = STATUS_LABEL;
  readonly sortLabel = SORT_LABEL;
  readonly entities = this.store.entities;
  readonly rows = this.view.rows;

  private readonly scroller = viewChild.required<ElementRef<HTMLDivElement>>('scroller');
  readonly scrollTop = signal(0);
  readonly height = signal(600);
  /** Index (into rows) of the row the keyboard is on. */
  readonly active = signal(0);

  readonly start = computed(() => Math.max(0, Math.floor((this.scrollTop() - HEAD_HEIGHT) / ROW_HEIGHT) - OVERSCAN));
  readonly end = computed(() =>
    Math.min(this.rows().length, Math.ceil((this.scrollTop() + this.height()) / ROW_HEIGHT) + OVERSCAN),
  );
  /**
   * The ids to render. Reading `version` here is what re-renders the visible
   * values: once per frame in batched mode, whatever the event rate.
   */
  readonly slice = computed(() => {
    this.store.version();
    return this.rows().slice(this.start(), this.end());
  });
  /** The row whose button is in the tab order: the active one if rendered, else the first rendered. */
  readonly tabbable = computed(() => {
    const a = Math.min(this.active(), this.rows().length - 1);
    return a >= this.start() && a < this.end() ? a : this.start();
  });

  constructor() {
    afterNextRender(() => {
      const el = this.scroller().nativeElement;
      this.height.set(el.clientHeight);
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.height.set(el.clientHeight)).observe(el);
    });
  }

  onScroll(): void {
    this.scrollTop.set(this.scroller().nativeElement.scrollTop);
  }

  onFocusOut(ev: FocusEvent): void {
    const to = ev.relatedTarget as Node | null;
    if (!to || !this.scroller().nativeElement.contains(to)) this.view.frozen.set(false);
  }

  onKey(ev: KeyboardEvent): void {
    if (!(ev.target instanceof HTMLButtonElement)) return;
    const page = Math.max(1, Math.floor((this.height() - HEAD_HEIGHT) / ROW_HEIGHT) - 1);
    const next = nextRow(ev.key, this.active(), this.rows().length, page);
    if (next === null) return;
    ev.preventDefault();
    this.focusIndex(next);
  }

  open(id: number, index: number): void {
    this.active.set(index);
    this.view.selected.set(id);
  }

  /** Moves the keyboard to row `index`, scrolling it into view. */
  focusIndex(index: number): void {
    const el = this.scroller().nativeElement;
    this.active.set(index);
    const top = index * ROW_HEIGHT; // row top, measured below the sticky header
    if (top < el.scrollTop) el.scrollTop = top;
    else if (HEAD_HEIGHT + top + ROW_HEIGHT > el.scrollTop + el.clientHeight)
      el.scrollTop = HEAD_HEIGHT + top + ROW_HEIGHT - el.clientHeight;
    this.scrollTop.set(el.scrollTop);
    const id = this.rows()[index];
    const focus = () => document.getElementById(`row-${id}`)?.focus({ preventScroll: true });
    // Usually the row is already rendered (it was next to the focused one,
    // or within the overscan); otherwise it appears on the next render.
    if (document.getElementById(`row-${id}`)) {
      focus();
    } else {
      // The focused row may be about to scroll out of the DOM; hold focus on
      // the scroller meanwhile so it never drops to <body> (which would also
      // unfreeze the order).
      el.focus({ preventScroll: true });
      afterNextRender(focus, { injector: this.injector });
    }
  }

  /** Puts focus back on an entity's row (after closing its details), or on the table. */
  focusEntity(id: number | null): void {
    const i = id === null ? -1 : this.rows().indexOf(id);
    this.focusIndex(i >= 0 ? i : this.tabbable());
  }
}
