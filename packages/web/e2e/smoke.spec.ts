import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURES, openPanel } from './helpers';

test.beforeEach(async ({ page }) => {
  // Force the <input type="file"> fallback so tests can supply files.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
});

async function openFixture(page: Page, name: string) {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));
}

async function clickViewportCentre(page: Page) {
  const box = await page.getByTestId('viewport').locator('canvas').boundingBox();
  if (!box) throw new Error('viewport canvas not found');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.move(x + 1, y); // second move so R3F registers hover
  await page.mouse.click(x + 1, y);
}

test('STL: import, lay flat, stock, WCS, then autosave restores everything', async ({ page }) => {
  await page.goto('/');

  // 1. import and confirm mm
  await openFixture(page, 'box-20x10x5.stl');
  await expect(page.getByTestId('units-dialog')).toBeVisible();
  await page.getByTestId('units-mm').click();
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 10.00 × 5.00 mm');

  // 2. lay the front face (-Y) flat: 20 × 10 × 5 becomes 20 × 5 × 10
  await page.getByTestId('view-front').click();
  await page.waitForTimeout(300);
  await openPanel(page, 'orientation');
  await page.getByTestId('pick-face').click();
  await expect(page.getByTestId('pick-hint')).toBeVisible();
  await clickViewportCentre(page);
  await openPanel(page, 'model');
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 5.00 × 10.00 mm');
  await expect(page.getByTestId('pick-hint')).toHaveCount(0);

  // 3. fixed stock 30 × 15 × 12 and the origin at the top centre
  await openPanel(page, 'stock');
  await page.getByTestId('stock-mode-fixed').click();
  await expect(page.getByTestId('stock-size')).toHaveText('30.00 × 15.00 × 11.00 mm');
  const sizeZ = page.getByTestId('stock-size-z');
  await sizeZ.fill('12');
  await sizeZ.press('Enter');
  await expect(page.getByTestId('stock-size')).toHaveText('30.00 × 15.00 × 12.00 mm');
  await openPanel(page, 'origin');
  await page.getByTestId('wcs-anchor-center-center').click();
  await page.getByTestId('wcs-z-top').click();
  await expect(page.getByTestId('wcs-position')).toHaveText('X 0.00 · Y 0.00 · Z 12.00 mm');

  // 4. autosave (1 s debounce) survives a reload
  await page.waitForTimeout(1500);
  await page.reload();
  // the remembered panel (Work origin) stays open once the restored job has loaded; the restore must not switch to Model
  await expect(page.getByTestId('wcs-position')).toHaveText('X 0.00 · Y 0.00 · Z 12.00 mm');
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'origin');
  await openPanel(page, 'model');
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 5.00 × 10.00 mm');
  await openPanel(page, 'stock');
  await expect(page.getByTestId('stock-mode-fixed')).toHaveAttribute('data-state', 'on');
  await openPanel(page, 'origin');
  await expect(page.getByTestId('wcs-position')).toHaveText('X 0.00 · Y 0.00 · Z 12.00 mm');
});

test('DXF with $INSUNITS = 4 imports without a units prompt and lists its layers', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'plate-mm.dxf');
  await expect(page.getByTestId('model-size')).toHaveText('100.00 × 60.00 × 0.00 mm');
  await expect(page.getByTestId('units-dialog')).toHaveCount(0);
  await expect(page.getByTestId('layer-OUTLINE')).toBeVisible();
  await expect(page.getByTestId('layer-HOLES')).toBeVisible();
});
