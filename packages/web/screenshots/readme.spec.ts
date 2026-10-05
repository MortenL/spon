// The README screenshots (docs/screenshots). Regenerate them when the UI or what a scene shows changes:
// pnpm --filter @sponcam/web screenshots
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURES, openPanel } from '../e2e/helpers';

const OUT = path.resolve(import.meta.dirname, '../../../docs/screenshots');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/');
});

const rows = (page: Page) => page.locator('[data-testid^="op-row-"]');

async function openFixture(page: Page, name: string) {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));
}

async function stockBottom(page: Page, mm: string) {
  await openPanel(page, 'stock');
  await page.getByTestId('stock-margin-bottom').fill(mm);
  await page.getByTestId('stock-margin-bottom').press('Enter');
}

async function addOp(page: Page, type: string) {
  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId(`add-op-${type}`).click();
  await expect(page.getByTestId('inspector')).toBeVisible();
}

async function pickTool(page: Page, id: string) {
  await page.getByTestId('inspector-tab-tool').click();
  await page.getByTestId('op-tool-library').click();
  await page.getByTestId(`op-tool-library-${id}`).click();
}

/** Ends picking, closes the inspector unless `keepInspector`, fits the view and saves the page once the viewport has rendered. */
async function shoot(page: Page, name: string, { keepInspector = false } = {}) {
  await page.keyboard.press('Escape');
  if (!keepInspector && (await page.getByTestId('inspector-close').count())) await page.getByTestId('inspector-close').click();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/** thread-plate.stl (a 60 × 40 plate with a Ø20 boss and a Ø6.8 hole): the outline profiled with tabs and the hole drilled. */
async function platePart(page: Page) {
  await openFixture(page, 'thread-plate.stl');
  await page.getByTestId('units-mm').click();
  await expect(page.getByTestId('model-size')).toBeVisible();
  await stockBottom(page, '6');
  await addOp(page, 'profile');
  await page.getByTestId('catalog-face-1').click(); // the plate top: its outline
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-tabs').click();
  await expect(rows(page).last()).toHaveAttribute('data-status', /ok|warning/);
  await addOp(page, 'drill');
  await page.getByTestId('catalog-hole-0').click();
  await expect(rows(page).last()).toHaveAttribute('data-status', /ok|warning/);
}

test('toolpaths: profile with tabs and drill on a model', async ({ page }) => {
  await platePart(page);
  await openPanel(page, 'operations');
  await shoot(page, 'toolpaths');
});

test('playback: the programs played back, with the analysis', async ({ page }) => {
  await platePart(page);
  await openPanel(page, 'programs');
  await page.getByTestId('dock-tab-analysis').click();
  await page.getByTestId('play').click();
  await expect(page.getByTestId('timeline-time')).not.toHaveText('0:00', { timeout: 5000 });
  await page.waitForTimeout(4000);
  await page.getByTestId('play').click();
  await shoot(page, 'playback');
});

test('threads: an M20 external thread on a boss, with the operation open', async ({ page }) => {
  await openFixture(page, 'thread-plate.stl');
  await page.getByTestId('units-mm').click();
  await expect(page.getByTestId('model-size')).toBeVisible();
  await stockBottom(page, '6');
  await addOp(page, 'thread');
  await pickTool(page, 'starter-thread-sp6');
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('thread-kind').getByText('External').click();
  await page.getByTestId('thread-size').selectOption('M20');
  await page.getByTestId('thread-length').fill('6');
  await page.getByTestId('thread-length').press('Enter');
  await page.getByTestId('inspector-tab-geometry').click();
  await page.getByTestId('catalog-boss-0').locator('input').check();
  await expect(rows(page).last()).toHaveAttribute('data-status', 'ok');
  await page.getByTestId('inspector-tab-passes').click();
  await shoot(page, 'threads', { keepInspector: true });
});
