import { Page, expect } from '@playwright/test';

/** A small fleet at a gentle rate: enough for alerts to arrive, slow enough to read. */
export const APP = '/?rate=600&n=400&seed=3';

export async function open(page: Page, url = APP): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId('connection')).toHaveText('Live');
  await expect(page.locator('tbody button.open').first()).toBeVisible();
}

/** What has focus, described. */
export function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName.toLowerCase() ?? '',
      id: el?.id ?? '',
      text: (el?.textContent ?? '').trim(),
      label: el?.getAttribute('aria-label') ?? '',
      rowindex: el?.closest('tr')?.getAttribute('aria-rowindex') ?? null,
      inDialog: !!el?.closest('dialog'),
    };
  });
}

/** Presses Tab until `match` holds for the focused element; fails after `max` presses. */
export async function tabTo(
  page: Page,
  match: (f: Awaited<ReturnType<typeof focused>>) => boolean,
  max = 80,
  key = 'Tab',
): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    if (match(await focused(page))) return;
  }
  throw new Error(`no focusable element matched after ${max} presses of ${key}`);
}

/** Waits until focus satisfies `match` (focus often moves on the next render). */
export async function expectFocus(
  page: Page,
  match: (f: Awaited<ReturnType<typeof focused>>) => boolean,
  what = 'expected focus',
): Promise<Awaited<ReturnType<typeof focused>>> {
  let last = await focused(page);
  await expect
    .poll(async () => {
      last = await focused(page);
      return match(last);
    }, { message: what, timeout: 3000 })
    .toBe(true);
  return last;
}
