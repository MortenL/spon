import fs from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { openPanel } from './helpers';

// The File System Access pickers are removed so the download and file-input fallbacks are used (the same as text.spec.ts).
const NO_PICKERS = () => {
  Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
  Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
};

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => void d.accept()); // opening a job over a changed one asks to discard the changes
  await page.addInitScript(NO_PICKERS);
  await page.goto('/');
});

const opRows = (page: Page) => page.locator('[data-testid^="op-row-"]');
const textRows = (page: Page) => page.locator('[data-testid^="text-row-"]');

async function setNumber(page: Page, testId: string, value: number) {
  const field = page.getByTestId(testId);
  await field.fill(String(value));
  await field.press('Enter');
}

async function pickTool(page: Page, id: string) {
  await page.getByTestId('inspector-tab-tool').click();
  await page.getByTestId('op-tool-library').click();
  await page.getByTestId(`op-tool-library-${id}`).click();
}

async function setContent(page: Page, value: string) {
  const content = page.getByTestId('text-content');
  await content.fill(value);
  await content.blur();
}

async function bytesOf(download: { path(): Promise<string | null> }): Promise<Buffer> {
  const p = await download.path();
  if (!p) throw new Error('download has no local path');
  return fs.readFile(p);
}

async function generatedStatuses(page: Page): Promise<string[]> {
  await openPanel(page, 'operations');
  return opRows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-status') ?? ''));
}

test('make an inlay from a V-carve, open the plug job, then update it', async ({ page }) => {
  // base: fixed stock with the text SPON, V-carved with the 60 degree V-bit
  await openPanel(page, 'stock');
  await setNumber(page, 'stock-size-x', 200);
  await setNumber(page, 'stock-size-y', 100);
  await setNumber(page, 'stock-size-z', 18);
  await openPanel(page, 'text');
  await page.getByTestId('text-add').click();
  await setContent(page, 'SPON');
  await setNumber(page, 'text-size', 50);
  await expect(textRows(page).first()).toContainText('SPON');
  await textRows(page).first().getByTestId('text-menu').click();
  await page.getByTestId('text-add-op').click();
  await page.getByTestId('text-add-op-vcarve').click();
  await expect(page.getByTestId('inspector')).not.toHaveAttribute('data-kind', 'text');
  await pickTool(page, 'starter-vbit-60');

  // make the inlay
  await openPanel(page, 'operations');
  await expect(opRows(page)).toHaveCount(1);
  await opRows(page).first().getByTestId('op-menu').click();
  await page.getByTestId('op-make-inlay').click();
  await expect(page.getByTestId('inlay-dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Make inlay' })).toBeVisible();
  await expect(page.getByTestId('inlay-depth')).toHaveValue('4.00');
  await expect(page.getByTestId('inlay-start-depth')).toHaveValue('2.00');
  await expect(page.getByTestId('inlay-glue-gap')).toHaveValue('0.50');
  await expect(page.getByTestId('inlay-margin')).toHaveValue('10.00');
  await expect(page.getByTestId('inlay-board-x')).not.toHaveValue('0'); // the default board is computed from the text
  await expect(page.getByTestId('inlay-ok')).toBeEnabled();
  const plugDownload = page.waitForEvent('download');
  await page.getByTestId('inlay-ok').click();
  const plug = await plugDownload;
  expect(plug.suggestedFilename()).toMatch(/ plug\.spon$/);
  const plugBytes = await bytesOf(plug);
  expect(plugBytes.length).toBeGreaterThan(0);
  await expect(page.getByTestId('inlay-dialog')).toBeHidden();
  await expect(page.getByTestId('inlay-open-plug')).toBeVisible();

  // the base gained a clearing and generates without errors
  await expect(opRows(page)).toHaveCount(2);
  await openPanel(page, 'programs');
  await expect(page.getByTestId('program-generated')).toHaveCount(2);
  const baseStatuses = await generatedStatuses(page);
  // the clearing is the first row; the 3 mm flat mill can't reach the letters' narrow corners, but the V-bit cleans them, so nothing is reported
  expect(baseStatuses).toEqual(['ok', 'ok']);
  await openPanel(page, 'operations');
  await expect(opRows(page).first().getByTestId('op-problem')).toHaveCount(0);

  // open the plug job (the base job is replaced after accepting the discard confirmation)
  await page.getByTestId('open-input').setInputFiles({ name: plug.suggestedFilename(), mimeType: 'application/octet-stream', buffer: plugBytes });
  await openPanel(page, 'text');
  await expect(textRows(page)).toHaveCount(1);
  await textRows(page).first().click();
  await expect(page.getByTestId('text-mirror')).toBeChecked();
  await openPanel(page, 'operations');
  await expect(opRows(page)).toHaveCount(2);
  await expect(opRows(page).filter({ hasText: 'V-carve plug' })).toHaveCount(1);
  await expect(opRows(page).filter({ hasText: /clearing/i })).toHaveCount(1);
  await openPanel(page, 'programs');
  await expect(page.getByTestId('program-generated')).toHaveCount(2);
  const plugStatuses = await generatedStatuses(page);
  // same as the base: the plug's V-bit cleans the floor between the letters that the 3 mm clearing mill can't reach
  expect(plugStatuses).toEqual(['ok', 'ok']);
  await openPanel(page, 'operations');
  await expect(opRows(page).first()).toContainText('clearing');
  await expect(opRows(page).last()).toContainText('V-carve plug');
  await expect(opRows(page).first().getByTestId('op-problem')).toHaveCount(0);
  const gcode = page.waitForEvent('download');
  await openPanel(page, 'programs');
  await page.getByTestId('export-gcode').click();
  if (await page.getByTestId('export-dialog').isVisible()) await page.getByTestId('export-confirm').click();
  expect((await bytesOf(await gcode)).length).toBeGreaterThan(0);
});

test('update an inlay after the text grows: the plug file is replaced with one text on a board that fits it', async ({ page }) => {
  await openPanel(page, 'stock');
  await setNumber(page, 'stock-size-x', 200);
  await setNumber(page, 'stock-size-y', 100);
  await setNumber(page, 'stock-size-z', 18);
  await openPanel(page, 'text');
  await page.getByTestId('text-add').click();
  await setContent(page, 'SPON');
  await setNumber(page, 'text-size', 50);
  await textRows(page).first().getByTestId('text-menu').click();
  await page.getByTestId('text-add-op').click();
  await page.getByTestId('text-add-op-vcarve').click();
  await pickTool(page, 'starter-vbit-60');
  await openPanel(page, 'operations');
  await opRows(page).first().getByTestId('op-menu').click();
  await page.getByTestId('op-make-inlay').click();
  await expect(page.getByTestId('inlay-board-x')).not.toHaveValue('0');
  const firstBoardX = Number(await page.getByTestId('inlay-board-x').inputValue());
  const first = page.waitForEvent('download');
  await page.getByTestId('inlay-ok').click();
  const firstPlug = await first;
  const firstBytes = await bytesOf(firstPlug);
  await expect(page.getByTestId('inlay-dialog')).toBeHidden();

  // make the text longer than the stored plug board, then update: the existing plug file is picked through a file input
  await openPanel(page, 'text');
  await textRows(page).first().click();
  await setContent(page, 'SPONS');
  await openPanel(page, 'operations');
  await opRows(page).last().getByTestId('op-menu').click();
  await page.getByTestId('op-make-inlay').click();
  await expect(page.getByRole('heading', { name: 'Update inlay' })).toBeVisible();
  // the stored board no longer holds the plug, so the dialog goes back to the default size
  await expect.poll(async () => Number(await page.getByTestId('inlay-board-x').inputValue())).toBeGreaterThan(firstBoardX + 20);
  const chooser = page.waitForEvent('filechooser');
  const second = page.waitForEvent('download');
  await page.getByTestId('inlay-ok').click();
  await (await chooser).setFiles({ name: firstPlug.suggestedFilename(), mimeType: 'application/octet-stream', buffer: firstBytes });
  const updated = await second;
  expect(updated.suggestedFilename()).toBe(firstPlug.suggestedFilename()); // written back under the same name
  const updatedBytes = await bytesOf(updated);
  await expect(page.getByTestId('inlay-dialog')).toBeHidden();

  await page.getByTestId('open-input').setInputFiles({ name: updated.suggestedFilename(), mimeType: 'application/octet-stream', buffer: updatedBytes });
  await openPanel(page, 'text');
  await expect(textRows(page)).toHaveCount(1);
  await expect(textRows(page).first()).toContainText('SPONS');
  await openPanel(page, 'operations');
  await expect(opRows(page)).toHaveCount(2);
  await expect(opRows(page).filter({ hasText: /clearing/i })).toHaveCount(1);
  await expect(opRows(page).filter({ hasText: 'V-carve plug' })).toHaveCount(1);
});
