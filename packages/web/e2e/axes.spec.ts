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

/** Exports the generated G-code and returns the X and Y of the first G1 line that moves both. */
async function firstCut(page: Page): Promise<{ x: number; y: number }> {
  await openPanel(page, 'programs');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-gcode').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-confirm').click();
  const download = await downloadPromise;
  const zipPath = await download.path();
  if (!zipPath) throw new Error('download has no local path');
  const bytes = await fs.readFile(zipPath);
  // one posted file downloads as plain G-code, several as a zip
  const text = download.suggestedFilename().endsWith('.zip')
    ? Object.values(unzipSync(bytes)).map((b) => strFromU8(b)).join('\n')
    : bytes.toString('utf8');
  const line = text.split('\n').find((l) => /^G1\b/.test(l) && /X-?\d/.test(l) && /Y-?\d/.test(l));
  if (!line) throw new Error('no G1 line with X and Y');
  return { x: Number(/X(-?[\d.]+)/.exec(line)![1]), y: Number(/Y(-?[\d.]+)/.exec(line)![1]) };
}

test('Reverse Y flips the posted Y and leaves the preview on the part', async ({ page }) => {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, 'cam-part.dxf'));
  await expect(page.getByTestId('model-size')).toBeVisible();
  await openPanel(page, 'stock');
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');

  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-profile').click();
  await expect(page.getByTestId('inspector')).toBeVisible();
  await page.getByTestId('catalog-contour-OUTLINE-0').click();
  await expect(page.locator('[data-testid^="op-row-"]').last()).toHaveAttribute('data-status', /ok|warning/);

  await openPanel(page, 'programs');
  await expect(page.getByTestId('program-generated')).not.toHaveCount(0);
  await page.getByTestId('dock-tab-analysis').click();
  const extents = page.getByTestId('analysis-extents-job');
  await expect(extents).toBeVisible();
  const extentsBefore = await extents.textContent();
  const before = await firstCut(page);

  await openPanel(page, 'origin');
  await page.getByTestId('wcs-reverse-y').check();
  await expect(page.getByTestId('wcs-axes-hint')).not.toHaveText('');
  const after = await firstCut(page);

  expect(Math.abs(before.y)).toBeGreaterThan(0.01);
  expect(after.y).toBeCloseTo(-before.y, 3);
  expect(after.x).toBeCloseTo(before.x, 3);

  // the preview is in Spon's frame: the toolpath extents (and so their place in the stock) do not move
  await page.getByTestId('dock-tab-analysis').click();
  await expect(page.getByTestId('analysis-extents-job')).toHaveText(extentsBefore!);
});
