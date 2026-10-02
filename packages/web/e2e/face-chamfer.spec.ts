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

async function addOp(page: Page, type: 'profile' | 'face' | 'chamfer') {
  await page.getByTestId('add-op').click();
  await page.getByTestId(`add-op-${type}`).click();
  await expect(page.getByTestId('inspector')).toBeVisible();
}
const lastRow = (page: Page) => page.locator('[data-testid^="op-row-"]').last();

test('DXF part: facing the stock top generates a program', async ({ page }) => {
  await openFixture(page, 'cam-part.dxf');
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');

  await addOp(page, 'face');
  await page.getByTestId('inspector-tab-passes').click();
  await expect(page.getByTestId('pass-face-area')).toBeVisible();
  // a drawing's default face depth is zero (stock top to stock top): take 0.5 mm off
  await expect(lastRow(page)).toHaveAttribute('data-status', 'error');
  await page.getByTestId('inspector-tab-heights').click();
  await page.getByTestId('height-bottom-offset').fill('-0.5');
  await page.getByTestId('height-bottom-offset').press('Enter');
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);
  await expect(page.getByTestId('program-generated')).toHaveCount(1);
});

test('DXF part: a chamfer mill chamfers the outline, with its depth computed', async ({ page }) => {
  await openFixture(page, 'cam-part.dxf');
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');

  // the starter library has no chamfer mill: add one
  await page.getByTestId('open-tool-library').click();
  await page.getByTestId('tool-add').click();
  await page.getByTestId('tool-field-name').fill('90 deg chamfer mill');
  await page.getByTestId('tool-field-type').selectOption('chamfer');
  await page.getByTestId('tool-field-diameter').fill('12');
  await page.getByTestId('tool-field-diameter').press('Enter');
  await page.getByTestId('tool-field-tipAngleDeg').fill('90');
  await page.getByTestId('tool-field-tipAngleDeg').press('Enter');
  await page.getByTestId('tool-save').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-library')).toHaveCount(0);

  await addOp(page, 'chamfer');
  await page.getByTestId('inspector-tab-tool').click();
  await page.getByTestId('op-tool-library').click();
  await page.getByRole('button', { name: /90 deg chamfer mill/ }).click();
  await page.getByTestId('inspector-tab-geometry').click();
  await page.getByTestId('catalog-contour-OUTLINE-0').click();
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-chamfer-deburr').click();
  await expect(page.getByTestId('chamfer-depth')).not.toHaveText('–');
  await expect(page.getByTestId('chamfer-depth')).toHaveText(/\d/);
  await expect(lastRow(page)).not.toHaveAttribute('data-status', 'error');
  await page.getByTestId('inspector-tab-heights').click();
  await expect(page.getByTestId('height-bottom-computed')).toContainText('Computed:');
});

test('STL: a cut into the model is an error that blocks export, until the depth is fixed', async ({ page }) => {
  await openFixture(page, 'stepped.stl');
  await page.getByTestId('units-mm').click();
  await addOp(page, 'profile');
  await page.getByTestId('catalog-face-0').click(); // the boss top, the topmost face
  await expect(lastRow(page)).toHaveAttribute('data-status', 'error');
  await page.getByTestId('dock-tab-analysis').click();
  const gouge = page.getByTestId('op-diagnostic').filter({ hasText: 'Cuts into the model' });
  await expect(gouge.first()).toBeVisible();

  await page.getByTestId('export-gcode').click();
  await expect(page.getByTestId('export-dialog')).toHaveCount(0);
  await expect(page.getByText('Cannot export G-code')).toBeVisible();

  // bottom at model top - 10: above the slab, so nothing is gouged
  await page.getByTestId('inspector-tab-heights').click();
  await page.getByTestId('height-bottom-from').selectOption('modelTop');
  await page.getByTestId('height-bottom-offset').fill('-10');
  await page.getByTestId('height-bottom-offset').press('Enter');
  await expect(lastRow(page)).not.toHaveAttribute('data-status', 'error');
  await expect(gouge).toHaveCount(0);
});
