import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/');
});

const openFixture = (page: Page, name: string) => page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));

async function addOp(page: Page, type: 'slot') {
  await page.getByTestId('add-op').click();
  await page.getByTestId(`add-op-${type}`).click();
  await expect(page.getByTestId('inspector')).toBeVisible();
}
const lastRow = (page: Page) => page.locator('[data-testid^="op-row-"]').last();

test('DXF centreline: a 10 mm slot is cut along a line and exports', async ({ page }) => {
  await openFixture(page, 'slot-lines.dxf');
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');
  await addOp(page, 'slot');
  await page.getByTestId('inspector-tab-geometry').click();
  await page.locator('[data-testid^="catalog-contour-SLOTS-"]').first().locator('input').check();
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-slot-width').fill('10');
  await page.getByTestId('pass-slot-width').press('Enter');
  await expect(page.getByTestId('slot-auto-line')).toContainText('Auto → Wider');
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);
  await expect(page.getByTestId('program-generated')).toHaveCount(1);
});

test('STL plate: a recognised square keyway blocks export until its ends are chosen', async ({ page }) => {
  await openFixture(page, 'slot-plate.stl');
  await page.getByTestId('units-mm').click();
  await addOp(page, 'slot');
  await page.getByTestId('inspector-tab-geometry').click();
  await page.locator('[data-testid^="catalog-slot-"]', { hasText: /8\.00 × 40\.00/ }).first().locator('input').check();
  await expect(lastRow(page)).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('op-diagnostic').filter({ hasText: 'Choose how square slot ends are cut' }).first()).toBeVisible();
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-slot-ends').selectOption('inside');
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);
  await expect(page.getByTestId('program-generated')).toHaveCount(1);
});
