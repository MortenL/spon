import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
});

async function openFixture(page: Page, name: string) {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));
}

test('G-code: load over a job, analyse, jump to the diagnostic, scrub, and restore after reload', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'box-20x10x5.stl');
  await page.getByTestId('units-mm').click();
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 10.00 × 5.00 mm');

  await openFixture(page, 'drill-arc.nc');
  const row = page.getByTestId('program-drill-arc.nc');
  await expect(row).toBeVisible();
  await expect(row.getByTestId('program-time')).toHaveText(/^\d+:\d{2}$/);

  // analysis: exactly one error, the deliberate rapid into the stock on line 18 (0-based 17)
  await page.getByTestId('dock-tab-analysis').click();
  const diagnostics = page.getByTestId('diagnostic');
  await expect(diagnostics).toHaveCount(1);
  await expect(diagnostics.first()).toHaveAttribute('data-code', 'rapid-into-stock');
  const total = await page.getByTestId('analysis-total-time').textContent();
  expect(total).toMatch(/^\d+:\d{2}$/);
  expect(total).not.toBe('0:00');
  await expect(row.getByTestId('program-time')).toHaveText(total!);

  // clicking the diagnostic shows and selects its line
  await diagnostics.first().click();
  await expect(page.locator('[data-testid="gcode-line"][data-selected="true"]')).toHaveAttribute('data-line', '17');

  // scrubbing to 90% moves the current line past the 30 s tool change (line 4 = index 3)
  await page.getByTestId('timeline-scrubber').fill('900');
  const current = page.locator('[data-testid="gcode-line"][data-current="true"]');
  await expect(current).toHaveCount(1);
  expect(Number(await current.getAttribute('data-line'))).toBeGreaterThan(3);

  // autosave restores the program and its analysis
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByTestId('program-drill-arc.nc')).toBeVisible();
  await page.getByTestId('dock-tab-analysis').click();
  await expect(page.getByTestId('diagnostic')).toHaveCount(1);
});

test('G-code without a model: rapids below Z 0 are reported and the machine profile changes the time', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'drill-arc.nc');
  const time = page.getByTestId('program-drill-arc.nc').getByTestId('program-time');
  await expect(time).toHaveText(/^\d+:\d{2}$/);
  const before = await time.textContent();

  // no stock: the deliberate rapid is reported as "below Z 0"
  await page.getByTestId('dock-tab-analysis').click();
  await expect(page.getByTestId('diagnostic')).toHaveCount(1);

  await page.getByRole('button', { name: 'Machine' }).click(); // expand the collapsed panel
  await page.getByTestId('machine-preset').selectOption('Generic VMC');
  await expect(time).not.toHaveText(before!); // 5 s tool change instead of 30 s
});
