import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { FIXTURES, openPanel } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/');
});

const rows = (page: Page) => page.locator('[data-testid^="op-row-"]');

async function setUpThreadOp(page: Page) {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, 'thread-plate.stl'));
  await page.getByTestId('units-mm').click();
  await expect(page.getByTestId('model-size')).toBeVisible();
  await openPanel(page, 'stock');
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');
  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-thread').click();
  await expect(page.getByTestId('inspector')).toBeVisible();
  await page.getByTestId('inspector-tab-tool').click();
  await page.getByTestId('op-tool-library').click();
  await page.getByTestId('op-tool-library-starter-thread-sp6').click();
}

async function exportGcode(page: Page): Promise<string> {
  await openPanel(page, 'programs');
  await expect(page.getByTestId('program-generated')).toHaveCount(1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-gcode').click();
  await page.getByTestId('export-confirm').click({ timeout: 2000 }).catch(() => undefined); // only asked when there are warnings
  const download = await downloadPromise;
  const saved = await download.path();
  if (!saved) throw new Error('download has no local path');
  const bytes = await fs.readFile(saved);
  if (!download.suggestedFilename().endsWith('.zip')) return strFromU8(bytes);
  return Object.values(unzipSync(bytes)).map((e) => strFromU8(e)).join('\n');
}

test('internal thread: an M8 thread in the through hole generates and exports arcs', async ({ page }) => {
  await setUpThreadOp(page);
  await page.getByTestId('inspector-tab-geometry').click();
  await page.getByTestId('catalog-hole-0').locator('input').check();
  await expect(rows(page).last()).toHaveAttribute('data-status', 'ok');
  const gcode = await exportGcode(page);
  expect(gcode.length).toBeGreaterThan(0);
  expect(gcode).toContain('G3');
});

test('external thread: an M20 thread on the boss generates and exports clockwise arcs', async ({ page }) => {
  await setUpThreadOp(page);
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('thread-kind').getByText('External').click();
  await page.getByTestId('thread-size').selectOption('M20');
  await page.getByTestId('thread-length').fill('6'); // the boss stands 8 mm above the plate
  await page.getByTestId('thread-length').press('Enter');
  await page.getByTestId('inspector-tab-geometry').click();
  await page.getByTestId('catalog-boss-0').locator('input').check();
  await expect(rows(page).last()).toHaveAttribute('data-status', 'ok');
  const gcode = await exportGcode(page);
  expect(gcode.length).toBeGreaterThan(0);
  expect(gcode).toContain('G2');
});

test('custom thread: 8 TPI reads out as a 3.175 mm pitch', async ({ page }) => {
  await setUpThreadOp(page);
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('thread-standard').selectOption('custom');
  await page.getByTestId('thread-pitch-unit').getByText('TPI').click();
  await expect(page.getByTestId('thread-pitch')).toHaveValue(/^20\.3/); // 1.25 mm shown as TPI
  await page.getByTestId('thread-pitch').fill('8');
  await page.getByTestId('thread-pitch').press('Enter');
  await expect(page.getByTestId('thread-pitch')).toHaveValue('8.00');
  await expect(page.getByTestId('thread-readouts')).toContainText('Thread depth 1.72 mm'); // 0.5413 × 3.175
  await page.getByTestId('thread-pitch-unit').getByText('mm').click();
  await expect(page.getByTestId('thread-pitch')).toHaveValue('3.175');
});
