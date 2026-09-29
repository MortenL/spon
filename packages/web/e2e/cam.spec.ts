import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/');
});

async function openFixture(page: Page, name: string) {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));
}

async function addOp(page: Page, type: 'profile' | 'pocket' | 'drill') {
  await page.getByTestId('add-op').click();
  await page.getByTestId(`add-op-${type}`).click();
  await expect(page.getByTestId('inspector')).toBeVisible();
}
const lastRow = (page: Page) => page.locator('[data-testid^="op-row-"]').last();

test('DXF part: profile with tabs, pocket and drill generate, play and export', async ({ page }) => {
  await openFixture(page, 'cam-part.dxf');
  // 6 mm thick stock under the drawing (the auto-stock bottom margin; the drawing lies on the stock top)
  await page.getByTestId('stock-margin-bottom').fill('6');
  await page.getByTestId('stock-margin-bottom').press('Enter');

  await addOp(page, 'profile');
  await page.getByTestId('catalog-contour-OUTLINE-0').click();
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-tabs').click();
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);

  await addOp(page, 'pocket');
  for (let i = 0; i < 5; i++) await page.getByTestId(`catalog-contour-POCKET-${i}`).click(); // 4 lines + the island circle
  await expect(lastRow(page)).toHaveAttribute('data-status', 'warning'); // unmachined square corners

  await addOp(page, 'drill');
  for (let i = 0; i < 4; i++) await page.getByTestId(`catalog-contour-HOLES-${i}`).click();
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);

  // GRBL default: split by tool → the flat end mill file and the drill file
  const generated = page.getByTestId('program-generated');
  await expect(generated).toHaveCount(2);
  await expect(page.getByText(/-01-T2\.nc/)).toBeVisible();
  await expect(page.getByText(/-02-T9\.nc/)).toBeVisible();
  await page.getByTestId('dock-tab-analysis').click();
  await expect(page.locator('[data-testid="op-diagnostic"][data-code="unmachined-area"]').first()).toBeVisible(); // the pocket's square corners
  await expect(page.locator('[data-testid="op-diagnostic"][data-code="heights-invalid"]')).toHaveCount(0);

  // plays
  await page.getByTestId('play').click();
  await expect(page.getByTestId('timeline-time')).not.toHaveText('0:00', { timeout: 5000 });
  await page.getByTestId('play').click();

  // LinuxCNC: a single file with canned cycles
  await page.getByRole('button', { name: 'Post' }).click();
  await page.getByTestId('post-dialect').selectOption('linuxcnc');
  await expect(generated).toHaveCount(1);
  await page.getByTestId('post-dialect').selectOption('grbl');
  await expect(generated).toHaveCount(2);

  // export: warnings → confirm → zip download, containing exactly the two posted files
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-gcode').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-confirm').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);

  const zipPath = await download.path();
  if (!zipPath) throw new Error('download has no local path');
  const entries = unzipSync(await fs.readFile(zipPath));
  const names = Object.keys(entries);
  expect(names).toHaveLength(2);
  const flatFile = names.find((n) => n.endsWith('-01-T2.nc'));
  const drillFile = names.find((n) => n.endsWith('-02-T9.nc'));
  expect(flatFile, names.join(', ')).toBeTruthy();
  expect(drillFile, names.join(', ')).toBeTruthy();
  for (const name of [flatFile!, drillFile!]) {
    const text = strFromU8(entries[name]);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('G21');
  }
});

test('errors block export; a face that is no longer horizontal breaks its operation', async ({ page }) => {
  await openFixture(page, 'plate-pocket.stl');
  await page.getByTestId('units-mm').click();
  await addOp(page, 'pocket');
  await page.getByTestId('catalog-face-1').click(); // the pocket floor (faces are listed top-down: top, floor, hole bottom)
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);

  await page.getByTestId('rotate-x-pos').click(); // +90° about X: the pocket floor is now vertical
  await expect(lastRow(page)).toHaveAttribute('data-status', 'error');
  await expect(page.getByTestId('op-diagnostic').first()).toHaveAttribute('data-code', 'face-not-horizontal');
  await page.getByTestId('export-gcode').click();
  await expect(page.getByTestId('export-dialog')).toHaveCount(0);
  await expect(page.getByText('Cannot export G-code')).toBeVisible();
});
