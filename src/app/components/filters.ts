import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, untracked, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Announcer } from '../announcer';
import { REGIONS, STATUS, STATUS_LABEL, Status } from '../model';
import { FleetView, SORT_LABEL, SortKey } from '../view';

@Component({
  selector: 'app-filters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <form class="filters" role="search" aria-label="Filter the fleet" (submit)="$event.preventDefault()">
      <div class="field">
        <label for="q">Search by name</label>
        <input
          #search
          id="q"
          type="search"
          autocomplete="off"
          spellcheck="false"
          aria-describedby="q-hint"
          [value]="view.query()"
          (input)="view.query.set(search.value)"
        />
        <span id="q-hint" class="visually-hidden">Matches any part of the name, for example eu-west or 0042</span>
      </div>
      <fieldset>
        <legend>Status</legend>
        @for (s of statuses; track s) {
          <label>
            <input type="checkbox" [checked]="view.statuses().has(s)" (change)="toggle(s)" />
            {{ label[s] }}
          </label>
        }
      </fieldset>
      <div class="field">
        <label for="region">Region</label>
        <select id="region" [value]="view.region()" (change)="view.region.set(region.value)" #region>
          <option value="all">All regions</option>
          @for (r of regions; track r) {
            <option [value]="r">{{ r }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label for="sort">Sort by</label>
        <select id="sort" [value]="view.sort()" (change)="view.sort.set($any(sort.value))" #sort>
          @for (k of sortKeys; track k) {
            <option [value]="k">{{ sortLabel[k] }}</option>
          }
        </select>
      </div>
      <p class="count" data-testid="row-count">Showing {{ view.rows().length | number }} of {{ view.total() | number }}</p>
    </form>
  `,
})
export class Filters {
  readonly view = inject(FleetView);
  private readonly announcer = inject(Announcer);
  readonly statuses = STATUS;
  readonly label = STATUS_LABEL;
  readonly regions = REGIONS;
  readonly sortLabel = SORT_LABEL;
  readonly sortKeys = Object.keys(SORT_LABEL) as SortKey[];
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>('search');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private first = true;

  constructor() {
    // Say how many rows match once the user stops changing filters.
    effect(() => {
      this.view.filters();
      if (this.first) {
        this.first = false;
        return;
      }
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const shown = untracked(this.view.rows).length;
        const total = untracked(this.view.total);
        this.announcer.say(`Showing ${shown.toLocaleString()} of ${total.toLocaleString()}`);
      }, 600);
    });
  }

  toggle(s: Status): void {
    this.view.toggleStatus(s);
  }

  focusSearch(): void {
    const el = this.search().nativeElement;
    el.focus();
    el.select();
  }
}
