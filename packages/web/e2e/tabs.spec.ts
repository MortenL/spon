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

  // a drag moves a tab along its contour and freezes the contour: the topmost tab, on the outline's top edge, to the right
  const centres = async () =>
    Promise.all((await handles(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!))).map((id) => markerCentre(page, id)));
  const nearest = async (to: { x: number; y: number }) => Math.min(...(await centres()).map((c) => Math.hypot(c.x - to.x, c.y - to.y)));
  const before = (await centres()).reduce((a, b) => (b.y < a.y ? b : a));
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 15, before.y, { steps: 5 });
  await page.mouse.move(before.x + 30, before.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('pass-tab-manual-count')).toHaveText('1 contour placed by hand');
  await expect(handles(page)).toHaveCount(4);
  // the tab sits where it was dropped and none is left where it was (its index may change: tabs are numbered along
  // the contour from a start of their own)
  await expect.poll(() => nearest(before)).toBeGreaterThan(10);
  await expect.poll(() => nearest({ x: before.x + 30, y: before.y })).toBeLessThan(6);
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

test('tabs on a slot: handles along the centreline', async ({ page }) => {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, 'slot-lines.dxf'));
  await expect(page.getByTestId('model-size')).toBeVisible();
  await openPanel(page, 'stock');
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');

  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-slot').click();
  await page.getByTestId('inspector-tab-geometry').click();
  await page.locator('[data-testid^="catalog-contour-SLOTS-"]').first().locator('input').check();
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-tabs').click();
  await page.getByTestId('pass-tab-count').fill('2');
  await page.getByTestId('pass-tab-count').press('Enter');
  await expect(opRows(page).last()).toHaveAttribute('data-status', /ok|warning/);
  await page.getByTestId('view-top').click();
  await expect(handles(page)).toHaveCount(2);
  await expect(page.getByTestId('tab-handle-0-0')).toBeAttached();
  await expect(page.getByTestId('tab-handle-0-1')).toBeAttached();
  await expect(page.getByTestId('tab-path-0')).toBeAttached();

  // a click on the centreline adds a third tab there and freezes the slot
  await clickMarker(page, 'tab-path-0');
  await expect(handles(page)).toHaveCount(3);
  await expect(page.getByTestId('pass-tab-manual-count')).toHaveText('1 contour placed by hand');
});

test('tabs on a through pocket: bridges hold the island', async ({ page }) => {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, 'cam-part.dxf'));
  await expect(page.getByTestId('model-size')).toBeVisible();
  await openPanel(page, 'stock');
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');

  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-pocket').click();
  for (let i = 0; i < 5; i++) await page.getByTestId(`catalog-contour-POCKET-${i}`).click(); // 4 lines + the island circle
  // through: 0.2 mm below the stock bottom
  await page.getByTestId('inspector-tab-heights').click();
  await page.getByTestId('height-bottom-from').selectOption('stockBottom');
  await page.getByTestId('height-bottom-offset').fill('-0.2');
  await page.getByTestId('height-bottom-offset').press('Enter');
  await page.getByTestId('inspector-tab-passes').click();
  await expect(page.getByTestId('pass-tab-no-islands')).toHaveCount(0);
  await page.getByTestId('pass-tabs').click();
  await expect(opRows(page).last()).toHaveAttribute('data-status', /ok|warning/);
  await page.getByTestId('view-top').click();
  await expect(page.getByTestId('tab-handle-0-0')).toBeVisible();
  await expect(page.getByTestId('tab-path-0')).toBeAttached();

  await openPanel(page, 'programs');
  await expect(page.getByTestId('program-generated')).toHaveCount(1);
  await page.getByTestId('dock-tab-analysis').click();
  await expect(page.getByTestId('analysis-total-time')).toBeVisible();
  await expect(page.locator('[data-testid="diagnostic"][data-code="below-stock-bottom"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="op-diagnostic"][data-code="unmachined-area"]').first()).toBeVisible(); // the pocket's square corners
  await expect(page.locator('[data-testid="op-diagnostic"][data-code="tab-bridge-long"]')).toHaveCount(0);
});
