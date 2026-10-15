import { expect, test } from '@playwright/test';

// Every store, and the zone.js build, run the same app.
for (const [name, url] of [
  ['batched', '/?rate=2000&n=500'],
  ['eager', '/?mode=eager&rate=2000&n=500'],
  ['naive', '/?mode=naive&rate=2000&n=500'],
  ['zone', '/zone/?rate=2000&n=500'],
] as const) {
  test(`${name}: streams, counts and renders`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await expect(page.getByTestId('connection')).toHaveText('Live');
    await expect.poll(async () => Number((await page.getByTestId('events-per-sec').textContent())?.replace(/,/g, ''))).toBeGreaterThan(1500);
    const counts = await Promise.all(
      ['ok', 'warn', 'crit', 'offline'].map(async (s) => Number((await page.getByTestId(`count-${s}`).textContent())?.replace(/,/g, ''))),
    );
    expect(counts.reduce((a, b) => a + b)).toBe(500);
    await expect(page.locator('footer')).toContainText(name === 'zone' ? 'zone.js' : name === 'batched' ? 'Batched' : name === 'eager' ? 'Eager' : 'Naive');
    expect(errors).toEqual([]);
  });
}
