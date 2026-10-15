import { expect, test } from '@playwright/test';
import { APP, expectFocus, focused, open, tabTo } from './helpers';

// Every feature, operated with the keyboard alone: no clicks, no
// programmatic focus, no selectOption.

test('the skip link goes straight to the table', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Tab');
  expect((await focused(page)).text).toBe('Skip to the fleet table');
  await page.keyboard.press('Enter');
  await expectFocus(page, (f) => /^row-\d+$/.test(f.id) && f.rowindex === '2', 'first row');
});

test('arrows, Page Down, End and Home move between rows, scrolling as needed', async ({ page }) => {
  await open(page);
  await tabTo(page, (f) => f.id.startsWith('row-'));
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  expect((await focused(page)).rowindex).toBe('5');
  await page.keyboard.press('ArrowUp');
  expect((await focused(page)).rowindex).toBe('4');
  await page.keyboard.press('PageDown');
  await expectFocus(page, (f) => Number(f.rowindex) > 10, 'a page down');
  await page.keyboard.press('End');
  const last = await expectFocus(page, (f) => f.rowindex === '401', 'the last row'); // 400 entities + the header row
  await expect(page.locator(`#${last.id}`)).toBeInViewport();
  await page.keyboard.press('Home');
  await expectFocus(page, (f) => f.rowindex === '2', 'the first row');
  // Only one row is ever in the tab order.
  expect(await page.locator('tbody button.open[tabindex="0"]').count()).toBe(1);
});

test('the order holds while the keyboard is in the table', async ({ page }) => {
  await open(page);
  await tabTo(page, (f) => f.id.startsWith('row-'));
  await expect(page.locator('#fleet-note')).toContainText('Row order is held');
  const before = await page.locator('tbody button.open').allTextContents();
  await page.waitForTimeout(2500); // more than two re-sort ticks
  expect(await page.locator('tbody button.open').allTextContents()).toEqual(before);
});

test('Enter opens details with focus on its heading; Escape closes and returns focus', async ({ page }) => {
  await open(page);
  await tabTo(page, (f) => f.id.startsWith('row-'));
  await page.keyboard.press('ArrowDown');
  const row = await focused(page);
  await page.keyboard.press('Enter');
  await expectFocus(page, (f) => f.id === 'detail-h' && f.text === row.text, 'details heading');
  await expect(page.getByRole('region', { name: row.text })).toBeVisible();
  await expect(page.getByRole('img', { name: /^CPU over the last/ })).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#detail-h')).toHaveCount(0);
  await expectFocus(page, (f) => f.id === row.id, 'the row again');
});

test('silence an entity from its details, and unsilence it', async ({ page }) => {
  await open(page);
  await tabTo(page, (f) => f.id.startsWith('row-'));
  await page.keyboard.press('Enter');
  await expectFocus(page, (f) => f.id === 'detail-h');
  await tabTo(page, (f) => f.text === 'Silence alerts for 15 minutes');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-live')).toContainText('silenced for 15 minutes');
  await expect(page.locator('app-detail')).toContainText('silenced until');
  await expectFocus(page, (f) => f.text === 'Unsilence', 'the replacement button');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-live')).toContainText('no longer silenced');
  await expectFocus(page, (f) => f.text === 'Silence alerts for 15 minutes');
});

test('/ searches by name; the result count is announced', async ({ page }) => {
  await open(page);
  await page.keyboard.press('/');
  await expectFocus(page, (f) => f.id === 'q');
  await page.keyboard.type('eu-west');
  await expect(page.getByTestId('status-live')).toHaveText(/^Showing \d+ of 400$/);
  const names = await page.locator('tbody button.open').allTextContents();
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n).toContain('eu-west');
});

test('status checkboxes, region and sort work from the keyboard', async ({ page }) => {
  await open(page);
  await tabTo(page, (f) => f.tag === 'input' && f.id === '' && f.label === '' && f.text === '', 30);
  // The first checkbox is "OK": turn it off.
  await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox', { name: 'OK' })).not.toBeChecked();
  await expect(page.locator('.fleet tbody .status[data-status="ok"]')).toHaveCount(0);
  await tabTo(page, (f) => f.id === 'region');
  await page.keyboard.press('ArrowDown'); // All regions -> eu-west
  await expect(page.locator('#region')).toHaveValue('eu-west');
  for (const region of await page.locator('.fleet tbody tr:not(.pad) td:nth-child(2)').allTextContents()) expect(region).toBe('eu-west');
  await page.keyboard.press('Tab');
  expect((await focused(page)).id).toBe('sort');
  await page.keyboard.press('End'); // last option: Name
  await expect(page.locator('#sort')).toHaveValue('name');
  const names = await page.locator('tbody button.open').allTextContents();
  expect(names).toEqual([...names].sort());
});

test('p pauses and resumes updates', async ({ page }) => {
  await open(page);
  await page.keyboard.press('p');
  await expect(page.getByTestId('paused')).toBeVisible();
  await expect(page.getByTestId('pause')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('status-live')).toHaveText('Updates paused.');
  const cells = page.locator('.fleet tbody tr:not(.pad) td.num');
  const frozen = await cells.allTextContents();
  await page.waitForTimeout(1500);
  expect(await cells.allTextContents()).toEqual(frozen);
  await page.keyboard.press('p');
  await expect(page.getByTestId('paused')).toHaveCount(0);
  await expect(page.getByTestId('status-live')).toHaveText('Updates resumed.');
  await expect.poll(() => cells.allTextContents()).not.toEqual(frozen);
});

test('acknowledge and silence alerts; the list holds still while focused', async ({ page }) => {
  await open(page, '/?rate=3000&n=400&seed=3');
  await expect(page.locator('.alerts button', { hasText: 'Acknowledge' }).first()).toBeVisible({ timeout: 20000 });
  await tabTo(page, (f) => f.text === 'Acknowledge', 200);
  const label = (await focused(page)).label;
  expect(label).toMatch(/^Acknowledge: (critical|warning) alert on \S+$/);
  const entity = label.split(' alert on ')[1];
  // Focus is in the feed: new alerts queue behind a button instead of moving the list.
  await expect(page.locator('.new-alerts')).toBeVisible({ timeout: 15000 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-live')).toContainText(`Acknowledged`);
  await expectFocus(page, (f) => f.label === `Silence 15 min: ${entity}`, 'the same alert'); // the pressed button is gone
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-live')).toHaveText(`Alerts from ${entity} silenced for 15 minutes.`);
});

test('the shortcuts dialog traps focus, closes with Escape, and returns focus', async ({ page }) => {
  await open(page);
  await tabTo(page, (f) => f.text === 'Keyboard shortcuts');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  // The page behind a modal dialog is inert: Tab cycles through the dialog
  // (and, in Chrome, out to the browser's own UI), never to page content.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    expect(f.inDialog || f.tag === 'body').toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectFocus(page, (f) => f.text === 'Keyboard shortcuts', 'the opener');
});

test('single-key shortcuts can be turned off', async ({ page }) => {
  await open(page);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toBeVisible();
  await tabTo(page, (f) => f.tag === 'input' && f.inDialog, 10);
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await expect(page.getByTestId('paused')).toHaveCount(0);
  await page.keyboard.press('/');
  expect((await focused(page)).id).not.toBe('q');
});

test('the theme toggle switches to dark and back', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  await tabTo(page, (f) => f.text === 'Dark theme');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Dark theme' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('opening an entity from an alert returns focus to the alert on close', async ({ page }) => {
  await open(page, '/?rate=3000&n=400&seed=3');
  await expect(page.locator('.alerts .link').first()).toBeVisible({ timeout: 20000 });
  await tabTo(page, (f) => f.tag === 'button' && f.id === '' && /^\S+-\S+-\S+-\d{4}$/.test(f.text) && !f.rowindex, 200);
  const link = await focused(page);
  await page.keyboard.press('Enter');
  await expectFocus(page, (f) => f.id === 'detail-h');
  await tabTo(page, (f) => f.text === 'Close details', 3, 'Tab');
  await page.keyboard.press('Enter');
  await expectFocus(page, (f) => f.text === link.text, 'the alert link');
});

test(`the app loads from ${APP} with no console errors`, async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});
