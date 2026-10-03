import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURES, openPanel } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  page.on('dialog', (d) => void d.accept()); // "discard unsaved changes?" when importing over a model
  await page.goto('/');
});

const openFixture = (page: Page, name: string) => page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));

async function addOp(page: Page, type: 'profile' | 'pocket' | 'drill') {
  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId(`add-op-${type}`).click();
  await expect(page.getByTestId('inspector')).toBeVisible();
}
const lastRow = (page: Page) => page.locator('[data-testid^="op-row-"]').last();

test('STL users never download the STEP reader; the first STEP file loads it', async ({ page }) => {
  const readerRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('occt-import-js')) readerRequests.push(r.url());
  });
  await openFixture(page, 'plate-pocket.stl');
  await page.getByTestId('units-mm').click();
  await expect(page.getByTestId('model-size')).not.toHaveText('—');
  expect(readerRequests).toEqual([]);

  await openFixture(page, 'box-hole.step');
  await expect(page.getByTestId('model-source')).toHaveText('STEP · body 1 of 1 · Bracket');
  expect(readerRequests.some((u) => u.includes('.wasm'))).toBe(true);
});

test('single-body STEP: no prompts, pocket and drill generate, and the job survives save and reopen', async ({ page }) => {
  await openFixture(page, 'box-hole.step');
  await expect(page.getByTestId('model-source')).toHaveText('STEP · body 1 of 1 · Bracket', { timeout: 30_000 });
  await expect(page.getByTestId('body-dialog')).toHaveCount(0);
  await expect(page.getByTestId('units-dialog')).toHaveCount(0);
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 10.00 × 5.00 mm');

  await addOp(page, 'pocket');
  await page.getByTestId('catalog-face-0').click(); // the top face (the only up-facing face)
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);
  await addOp(page, 'drill');
  await page.getByTestId('catalog-hole-0').click(); // the Ø8 through hole
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);
  await openPanel(page, 'programs');
  await expect(page.getByTestId('program-generated').first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('save').click();
  const download = await downloadPromise;
  const saved = await download.path();
  if (!saved) throw new Error('download has no local path');

  await page.getByTestId('new').click();
  await expect(page.getByTestId('model-source')).toHaveCount(0);
  await page.getByTestId('open-input').setInputFiles({ name: 'box-hole.spon', mimeType: 'application/octet-stream', buffer: await fs.readFile(saved) });
  await expect(page.getByTestId('model-source')).toHaveText('STEP · body 1 of 1 · Bracket', { timeout: 30_000 });
  await openPanel(page, 'operations');
  const rows = page.locator('[data-testid^="op-row-"]');
  await expect(rows).toHaveCount(2);
  for (let i = 0; i < 2; i++) await expect(rows.nth(i)).toHaveAttribute('data-status', /ok|warning/);
});

test('multi-body STEP asks which body; the choice survives a reload', async ({ page }) => {
  await openFixture(page, 'two-bodies.step');
  await expect(page.getByTestId('body-dialog')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid^="body-row-"]')).toHaveCount(2);
  await expect(page.getByTestId('body-row-1')).toHaveAttribute('data-state', 'checked'); // the larger body is the default
  await page.getByTestId('body-row-0').click();
  await page.getByTestId('body-import').click();
  await expect(page.getByTestId('model-source')).toHaveText('STEP · body 1 of 2 · Small block');
  await expect(page.getByTestId('model-size')).toHaveText('10.00 × 10.00 × 5.00 mm');

  await page.waitForTimeout(1500); // autosave (1 s debounce)
  await page.reload();
  await expect(page.getByTestId('model-source')).toHaveText('STEP · body 1 of 2 · Small block', { timeout: 30_000 });
  await expect(page.getByTestId('model-size')).toHaveText('10.00 × 10.00 × 5.00 mm');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('save').click();
  const download = await downloadPromise;
  const saved = await download.path();
  if (!saved) throw new Error('download has no local path');

  await page.getByTestId('new').click();
  await expect(page.getByTestId('model-source')).toHaveCount(0);
  await page.getByTestId('open-input').setInputFiles({ name: 'two-bodies.spon', mimeType: 'application/octet-stream', buffer: await fs.readFile(saved) });
  await expect(page.getByTestId('model-source')).toHaveText('STEP · body 1 of 2 · Small block', { timeout: 30_000 });
  await expect(page.getByTestId('model-size')).toHaveText('10.00 × 10.00 × 5.00 mm');
});

test('IGES imports the same way', async ({ page }) => {
  await openFixture(page, 'box.iges');
  await expect(page.getByTestId('model-source')).toHaveText('IGES · body 1 of 1 · Body 1', { timeout: 30_000 });
  await expect(page.getByTestId('body-dialog')).toHaveCount(0);
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 10.00 × 5.00 mm');
  await addOp(page, 'pocket');
  await page.getByTestId('catalog-face-0').click();
  await expect(lastRow(page)).toHaveAttribute('data-status', /ok|warning/);
});
