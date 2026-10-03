import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURES, openPanel } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/');
});

const openFixture = (page: Page, name: string) => page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));

async function addOp(page: Page, type: 'engrave' | 'vcarve') {
  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId(`add-op-${type}`).click();
  await expect(page.getByTestId('inspector')).toBeVisible();
}

async function pickVbit(page: Page, id: string) {
  await page.getByTestId('inspector-tab-tool').click();
  await page.getByTestId('op-tool-library').click();
  await page.getByTestId(`op-tool-library-${id}`).click();
}

const rows = (page: Page) => page.locator('[data-testid^="op-row-"]');

test('SVG letters: a V-carve with a max depth warns, and its linked clearing makes it ok', async ({ page }) => {
  await openFixture(page, 'vcarve-spon.svg');
  const dialog = page.getByTestId('svg-scale-dialog');
  await expect(dialog.or(page.getByTestId('model-size'))).toBeVisible(); // a mm SVG opens straight away; a px SVG asks for its scale
  if (await dialog.count()) await page.getByTestId('svg-scale-72').click();
  await expect(page.getByTestId('model-size')).toBeVisible();
  await openPanel(page, 'stock');
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');
  await addOp(page, 'vcarve');
  await pickVbit(page, 'starter-vbit-60');
  await page.getByTestId('inspector-tab-geometry').click();
  const contours = page.locator('[data-testid^="catalog-contour-LETTERS-"]');
  await expect(contours.first()).toBeVisible();
  const n = await contours.count();
  expect(n).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < n; i++) await contours.nth(i).locator('input').check();
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-vcarve-max-depth-on').check();
  await page.getByTestId('pass-vcarve-max-depth').fill('2');
  await page.getByTestId('pass-vcarve-max-depth').press('Enter');
  await expect(rows(page).last()).toHaveAttribute('data-status', 'warning');

  await page.getByTestId('vcarve-add-clearing').click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('V-carve clearing 1');
  await expect(rows(page).last()).toHaveAttribute('data-status', 'ok');

  await openPanel(page, 'programs');
  await expect(page.getByTestId('program-generated')).toHaveCount(2); // one program per tool: the flat clearing mill and the V-bit
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-gcode').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-confirm').click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.zip$/);
});

test('DXF lines: an engraving with a 0.6 mm line width generates a program', async ({ page }) => {
  await openFixture(page, 'engrave-lines.dxf');
  await expect(page.getByTestId('model-size')).toBeVisible(); // the import has finished and brought the Model panel forward
  await openPanel(page, 'stock');
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');
  await addOp(page, 'engrave');
  await pickVbit(page, 'starter-vbit-60');
  await page.getByTestId('inspector-tab-geometry').click();
  const contours = page.locator('[data-testid^="catalog-contour-ENGRAVE-"]');
  await expect(contours.first()).toBeVisible();
  const n = await contours.count();
  expect(n).toBe(3);
  for (let i = 0; i < n; i++) await contours.nth(i).locator('input').check();
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-engrave-mode').selectOption('width');
  await page.getByTestId('pass-engrave-width').fill('0.6');
  await page.getByTestId('pass-engrave-width').press('Enter');
  await expect(rows(page).last()).toHaveAttribute('data-status', /ok|warning/);
  await openPanel(page, 'programs');
  await expect(page.getByTestId('program-generated')).toHaveCount(1);
});
