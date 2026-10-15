import { TestBed } from '@angular/core/testing';
import { CONFIG, DEFAULTS, STORE } from '../config';
import { BatchedStore } from '../store';
import { FleetTable } from './fleet-table';

describe('FleetTable', () => {
  async function render(n: number) {
    const fleet = Array.from({ length: n }, (_, id) => ({ id, name: `api-eu-west-${String(id).padStart(4, '0')}`, region: 'eu-west', kind: 'api' }));
    TestBed.configureTestingModule({
      providers: [
        { provide: CONFIG, useValue: DEFAULTS },
        { provide: STORE, useValue: new BatchedStore(fleet, { schedule: () => {} }) },
      ],
    });
    const fixture = TestBed.createComponent(FleetTable);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('renders a window of rows, with the position of each in the whole list', async () => {
    const { el } = await render(1000);
    const table = el.querySelector('table')!;
    expect(table.getAttribute('aria-rowcount')).toBe('1001');
    const rows = [...el.querySelectorAll('tbody tr:not(.pad)')];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(40);
    expect(rows.map((r) => r.getAttribute('aria-rowindex')).slice(0, 3)).toEqual(['2', '3', '4']);
    // A spacer keeps the scroll height of the rows not rendered, hidden from assistive technology.
    const pad = el.querySelector<HTMLElement>('tbody tr.pad')!;
    expect(pad.getAttribute('aria-hidden')).toBe('true');
    expect(parseInt(pad.style.height, 10)).toBe((1000 - rows.length) * 36);
  });

  it('puts exactly one row in the tab order and moves it with the arrow keys', async () => {
    const { fixture, el } = await render(50);
    const tabbable = () => [...el.querySelectorAll<HTMLButtonElement>('button.open')].filter((b) => b.tabIndex === 0);
    expect(tabbable().map((b) => b.id)).toEqual(['row-0']);
    const first = tabbable()[0];
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await fixture.whenStable();
    expect(tabbable().map((b) => b.id)).toEqual(['row-1']);
    expect(document.activeElement?.id).toBe('row-1');
  });
});
