import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { open } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: Page, label: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes[0]?.target.join(' ')} — ${v.help}`);
  expect(summary, `axe violations in ${label}`).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, '/?rate=3000&n=400&seed=3');
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await expect(page.locator('.alerts li[data-severity]').first()).toBeVisible({ timeout: 20000 });
    });

    test('no axe violations: the dashboard streaming', async ({ page }) => {
      await audit(page, `${scheme}: dashboard`);
    });

    test('no axe violations: details open, alerts acknowledged, paused', async ({ page }) => {
      await page.locator('tbody button.open').first().press('Enter');
      await expect(page.locator('#detail-h')).toBeFocused();
      await page.locator('.alerts button', { hasText: 'Acknowledge' }).first().press('Enter');
      await page.getByTestId('pause').press('Enter');
      await audit(page, `${scheme}: details`);
    });

    test('no axe violations: the shortcuts dialog', async ({ page }) => {
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog')).toBeVisible();
      await audit(page, `${scheme}: dialog`);
    });

    test('no axe violations: no rows match', async ({ page }) => {
      await page.keyboard.press('/');
      await page.keyboard.type('nothing-matches-this');
      await expect(page.getByText('No entities match these filters.')).toBeVisible();
      await audit(page, `${scheme}: empty`);
    });
  });
}

test('alert announcements are batched: at most one every ten seconds', async ({ page }) => {
  await open(page, '/?rate=10000&n=400&seed=3');
  await page.locator('#announce').selectOption('all');
  await page.evaluate(() => {
    const w = window as unknown as { __announcements: string[] };
    w.__announcements = [];
    const region = document.querySelector('[data-testid="alerts-live"]')!;
    new MutationObserver(() => {
      const t = region.textContent?.trim();
      if (t) w.__announcements.push(t);
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
  await page.waitForTimeout(21_000);
  const said = await page.evaluate(() => (window as unknown as { __announcements: string[] }).__announcements);
  const raised = await page.locator('.alerts li[data-severity]').count();
  expect(raised).toBeGreaterThan(20); // plenty of alerts arrived...
  expect(said.length).toBeGreaterThanOrEqual(1); // ...were summarised...
  expect(said.length).toBeLessThanOrEqual(3); // ...in at most one sentence per 10 s
});

test('with reduced motion, nothing animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const animated = await page.evaluate(() =>
    [...document.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return parseFloat(cs.transitionDuration) > 0 || cs.animationName !== 'none';
    }).length,
  );
  expect(animated).toBe(0);
});
