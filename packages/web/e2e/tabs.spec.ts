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

const handles = (page: Page) => page.locator('[data-testid^="tab-handle-"]');
const opRows = (page: Page) => page.locator('[data-testid^="op-row-"]');

/** Where a tab marker sits on screen, once it stands still (the camera may still be moving to a view preset). */
async function markerCentre(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const centre = async () => {
    const box = await page.getByTestId(testId).boundingBox();
    return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
  };
  let at: { x: number; y: number } | null = null;
  await expect(async () => {
    const a = await centre();
    await page.waitForTimeout(150);
    at = await centre();
    expect(a && at && Math.hypot(a.x - at.x, a.y - at.y) < 0.5).toBe(true);
  }).toPass({ timeout: 10_000 });
  return at!;
}

/**
 * Clicks the viewport where a tab marker sits. The markers are screen-space anchors that take no pointer events,
 * so the click reaches the 3D handle or path under them.
 */
async function clickMarker(page: Page, testId: string) {
  const { x, y } = await markerCentre(page, testId);
  await page.mouse.move(x - 1, y);
  await page.mouse.move(x, y); // second move so R3F registers hover
  await page.mouse.click(x, y);
}

test('tabs: add on the path, select, remove with Delete and ×, reset one contour, undo', async ({ page }) => {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, 'cam-part.dxf'));
  await expect(page.getByTestId('model-size')).toBeVisible();
  await openPanel(page, 'stock');
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');

  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-profile').click();
  await page.getByTestId('catalog-contour-OUTLINE-0').click();
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-tabs').click();
  await expect(opRows(page).last()).toHaveAttribute('data-status', /ok|warning/);
  await page.getByTestId('view-top').click();
  await expect(handles(page)).toHaveCount(4);
  await expect(page.getByTestId('pass-tab-manual-count')).toHaveCount(0);

  // a drag moves a tab along its contour and freezes the contour
  const before = await markerCentre(page, 'tab-handle-0-0');
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 15, before.y, { steps: 5 });
  await page.mouse.move(before.x + 30, before.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('pass-tab-manual-count')).toHaveText('1 contour placed by hand');
  await expect(handles(page)).toHaveCount(4);
  await expect.poll(async () => Math.abs((await markerCentre(page, 'tab-handle-0-0')).x - before.x)).toBeGreaterThan(10);
  await expect(page.getByTestId('tab-remove')).toHaveCount(0); // a drag does not select
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('pass-tab-manual-count')).toHaveCount(0);

  // a click on the tab path adds a tab there and freezes the contour
  await clickMarker(page, 'tab-path-0');
  await expect(handles(page)).toHaveCount(5);
  await expect(page.getByTestId('pass-tab-manual-count')).toHaveText('1 contour placed by hand');

  // click selects; Delete removes the tab, not the operation
  await clickMarker(page, 'tab-handle-0-0');
  await expect(page.getByTestId('tab-handle-0-0')).toHaveAttribute('data-selected', 'true');
  await expect(page.getByTestId('tab-remove')).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(handles(page)).toHaveCount(4);
  await expect(opRows(page)).toHaveCount(1);

  // Esc deselects
  await clickMarker(page, 'tab-handle-0-1');
  await expect(page.getByTestId('tab-remove')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tab-remove')).toHaveCount(0);

  // the × of the selected tab removes it
  await clickMarker(page, 'tab-handle-0-1');
  await page.getByTestId('tab-remove').click();
  await expect(handles(page)).toHaveCount(3);

  // "Automatic for this contour" needs a selected tab
  await expect(page.getByTestId('pass-tab-reset-contour')).toBeDisabled();
  await expect(page.getByTestId('pass-tab-reset-contour')).toHaveText('Automatic for this contour');
  await clickMarker(page, 'tab-handle-0-0');
  await expect(page.getByTestId('pass-tab-reset-contour')).toBeEnabled();
  await page.getByTestId('pass-tab-reset-contour').click();
  await expect(handles(page)).toHaveCount(4);
  await expect(page.getByTestId('pass-tab-manual-count')).toHaveCount(0);

  await page.keyboard.press('Control+z');
  await expect(handles(page)).toHaveCount(3);
  await expect(page.getByTestId('pass-tab-manual-count')).toHaveText('1 contour placed by hand');
});
