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

const open = (page: Page, rel: string) => page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, rel));

test('Inkscape SVG opens without a prompt; an open line profiles on its right with a direction arrow', async ({ page }) => {
  await open(page, 'svg/inkscape.svg');
  await expect(page.getByTestId('svg-scale-dialog')).toHaveCount(0);
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-profile').click();
  await page.getByTestId('catalog-contour-Engrave-0').click();
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-open-side').getByText('Right').click();
  await expect(page.locator('[data-testid^="op-row-"]').last()).toHaveAttribute('data-status', /ok|warning/);
  await page.getByTestId('inspector-tab-geometry').click();
  await expect(page.getByTestId('geo-reverse-0')).toBeVisible();
});

test('a px SVG asks for its scale and shows the resulting size', async ({ page }) => {
  await open(page, 'svg/illustrator.svg');
  const dialog = page.getByTestId('svg-scale-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('svg-scale-72')).toContainText('44.45 × 19.05 mm');
  await page.getByTestId('svg-scale-72').click();
  await expect(dialog).toHaveCount(0);
  // the catalog lists once an operation is selected (adapted: there is no catalog without one)
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-profile').click();
  await expect(page.getByTestId('catalog-list')).toContainText('#ff0000');
  await expect(page.getByTestId('catalog-contour-#ff0000-0')).toBeVisible();
  await expect(page.getByTestId('catalog-contour-#0000ff-0')).toBeVisible();
});

test('a LinuxCNC tool.tbl imports in inches with its T numbers', async ({ page }) => {
  await page.getByTestId('open-tool-library').click();
  await page.getByTestId('tool-import-input').setInputFiles(path.join(FIXTURES, 'tool.tbl'));
  await expect(page.getByTestId('tool-table-units')).toBeVisible();
  await page.getByTestId('tool-table-units-in').click();
  await expect(page.getByText(/Imported 7 tools/)).toBeVisible();
  await expect(page.getByTestId('library-tool-linuxcnc-T2')).toContainText('Spiralbohrer 1/8');
});
