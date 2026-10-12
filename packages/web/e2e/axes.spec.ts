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
  await openPanel(page, 'operations');
  // an export while the toolpaths regenerate is refused, so wait for the operation to settle
  await expect(page.locator('[data-testid^="op-row-"]').last()).toHaveAttribute('data-status', /ok|warning/);
  await openPanel(page, 'programs');
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-gcode').click();
  await page.getByTestId('export-confirm').click({ timeout: 2000 }).catch(() => undefined); // only asked when there are warnings
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

  // The preview is drawn in Spon's frame, so it must not move. The extents are tool-centre positions: the profile runs outside
  // the outline, so X and Y may reach one tool radius (3 mm) past the stock; the top is the safe height and the bottom a small overcut, so Z is not compared.
  const radius = 3;
  await openPanel(page, 'stock');
  const stock = numbers(await page.getByTestId('stock-bounds').textContent());
  await page.getByTestId('dock-tab-analysis').click();
  // the re-analysis follows the flip asynchronously: poll until the extents lie on the stock
  await expect.poll(async () => {
    const [x0, y0, , x1, y1] = numbers(await page.getByTestId('analysis-extents-job').textContent());
    return x0 >= stock[0] - radius && y0 >= stock[1] - radius && x1 <= stock[3] + radius && y1 <= stock[4] + radius;
  }).toBe(true);
  await expect(page.getByTestId('analysis-extents-job')).toHaveText(extentsBefore!); // and they are where they were before the flip
});

/** The numbers of a "X 1.00, Y 2.00, Z 3.00 mm" text, in order; a min and a max point give six. */
function numbers(text: string | null): number[] {
  return [...(text ?? '').matchAll(/[XYZ] (-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}
