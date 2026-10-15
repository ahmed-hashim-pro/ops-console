import { ChangeDetectionStrategy, Component, ElementRef, inject, viewChild } from '@angular/core';
import { ThemeService } from '../theme';

/** A native modal <dialog>: it traps focus, closes on Escape and returns focus to the opener. */
@Component({
  selector: 'app-shortcuts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog aria-labelledby="sc-h">
      <h2 id="sc-h">Keyboard shortcuts</h2>
      <table>
        <caption class="visually-hidden">Shortcuts</caption>
        <tbody>
          <tr><th scope="row"><kbd>/</kbd></th><td>Search by name</td></tr>
          <tr><th scope="row"><kbd>p</kbd></th><td>Pause or resume updates</td></tr>
          <tr><th scope="row"><kbd>?</kbd></th><td>This list</td></tr>
          <tr><th scope="row"><kbd>↑</kbd> <kbd>↓</kbd></th><td>In the table: previous or next row</td></tr>
          <tr><th scope="row"><kbd>PgUp</kbd> <kbd>PgDn</kbd></th><td>In the table: a page up or down</td></tr>
          <tr><th scope="row"><kbd>Home</kbd> <kbd>End</kbd></th><td>In the table: first or last row</td></tr>
          <tr><th scope="row"><kbd>Enter</kbd></th><td>Open the row's details</td></tr>
          <tr><th scope="row"><kbd>Esc</kbd></th><td>Close details, or this dialog</td></tr>
        </tbody>
      </table>
      <label>
        <input type="checkbox" [checked]="theme.shortcuts()" (change)="theme.shortcuts.set(!theme.shortcuts())" />
        Single-key shortcuts (<kbd>/</kbd>, <kbd>p</kbd>, <kbd>?</kbd>)
      </label>
      <div class="dialog-actions">
        <button type="button" (click)="close()">Close</button>
      </div>
    </dialog>
  `,
})
export class Shortcuts {
  readonly theme = inject(ThemeService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  open(): void {
    const d = this.dialog().nativeElement;
    if (!d.open) d.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  get isOpen(): boolean {
    return this.dialog().nativeElement.open;
  }
}
