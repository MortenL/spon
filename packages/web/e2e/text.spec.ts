import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURES, openPanel } from './helpers';

const NO_PICKERS = () => {
  Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
  Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(NO_PICKERS);
  await page.goto('/');
});

const openFixture = (page: Page, name: string) => page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));
const opRows = (page: Page) => page.locator('[data-testid^="op-row-"]');
const textRows = (page: Page) => page.locator('[data-testid^="text-row-"]');
const numberOf = async (page: Page, testId: string) => Number.parseFloat(await page.getByTestId(testId).inputValue());

async function setNumber(page: Page, testId: string, value: number) {
  const field = page.getByTestId(testId);
  await field.fill(String(value));
  await field.press('Enter');
}

async function setStock(page: Page, x: number, y: number, z: number) {
  await openPanel(page, 'stock');
  await setNumber(page, 'stock-size-x', x);
  await setNumber(page, 'stock-size-y', y);
  await setNumber(page, 'stock-size-z', z);
}

async function addText(page: Page) {
  await openPanel(page, 'text');
  await page.getByTestId('text-add').click();
  await expect(page.getByTestId('text-content')).toBeVisible();
}

async function setContent(page: Page, value: string) {
  const content = page.getByTestId('text-content');
  await content.fill(value);
  await content.blur();
}

async function canvasBox(page: Page) {
  const box = await page.getByTestId('viewport').locator('canvas').boundingBox();
  if (!box) throw new Error('viewport canvas not found');
  return box;
}

/** Clicks around the viewport centre until a click selects the text (its lines are thin), and returns that point. */
async function findText(page: Page): Promise<{ x: number; y: number }> {
  const box = await canvasBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  let found: { x: number; y: number } | null = null;
  await expect(async () => {
    await page.getByTestId('inspector-close').click({ timeout: 1000 }).catch(() => {}); // deselect first: a click on the lines selects again
    for (let dy = -30; dy <= 30 && !found; dy += 3) {
      for (let dx = -120; dx <= 120 && !found; dx += 3) {
        await page.mouse.move(cx + dx, cy + dy);
        await page.mouse.click(cx + dx, cy + dy);
        if (await page.getByTestId('text-x').isVisible()) found = { x: cx + dx, y: cy + dy };
      }
    }
    expect(found).not.toBeNull();
  }).toPass({ timeout: 30_000 });
  return found!;
}

async function pickTool(page: Page, id: string) {
  await page.getByTestId('inspector-tab-tool').click();
  await page.getByTestId('op-tool-library').click();
  await page.getByTestId(`op-tool-library-${id}`).click();
}

async function addOpFromRow(page: Page, kind: 'vcarve' | 'engrave' | 'pocket') {
  await openPanel(page, 'text');
  await textRows(page).first().getByTestId('text-menu').click();
  await page.getByTestId('text-add-op').click();
  await page.getByTestId(`text-add-op-${kind}`).click();
  await expect(page.getByTestId('inspector')).not.toHaveAttribute('data-kind', 'text');
}

test('sign without a model: drag, undo, V-carve with clearing, generate and export', async ({ page }) => {
  await setStock(page, 200, 100, 18);
  await addText(page);
  await setContent(page, 'SPON');
  await setNumber(page, 'text-size', 30);
  await expect(textRows(page).first()).toContainText('SPON');

  // select it by clicking its lines, then drag it sideways in the view
  await page.getByTestId('view-top').click();
  await page.waitForTimeout(500);
  const hit = await findText(page);
  const x0 = await numberOf(page, 'text-x');
  const y0 = await numberOf(page, 'text-y');
  const dragPx = async () => {
    await page.mouse.move(hit.x, hit.y);
    await page.mouse.down();
    await page.mouse.move(hit.x + 30, hit.y, { steps: 6 });
    await page.mouse.move(hit.x + 60, hit.y, { steps: 6 });
    await page.mouse.up();
  };
  await dragPx();
  await expect.poll(() => numberOf(page, 'text-x')).toBeGreaterThan(x0 + 3);
  const moved = (await numberOf(page, 'text-x')) - x0;
  expect(Math.abs((await numberOf(page, 'text-y')) - y0)).toBeLessThan(1); // a horizontal drag moves along X only
  expect(moved).toBeLessThan(200); // tens of mm for 60 px, never a jump past the stock

  await page.keyboard.press('Control+z'); // the drag was one undo step
  await expect.poll(() => numberOf(page, 'text-x')).toBeCloseTo(x0, 6);
  expect(await numberOf(page, 'text-y')).toBeCloseTo(y0, 6);
  await dragPx(); // the same screen distance gives the same distance in mm
  await expect.poll(() => numberOf(page, 'text-x')).toBeCloseTo(x0 + moved, 0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => numberOf(page, 'text-x')).toBeCloseTo(x0, 6);

  await addOpFromRow(page, 'vcarve');
  await pickTool(page, 'starter-vbit-60');
  await page.getByTestId('inspector-tab-passes').click();
  await page.getByTestId('pass-vcarve-max-depth-on').check();
  await setNumber(page, 'pass-vcarve-max-depth', 0.5);
  await page.getByTestId('vcarve-add-clearing').click();
  await expect(opRows(page)).toHaveCount(2);
  await pickTool(page, 'starter-flat-3');
  await expect(opRows(page).first()).toHaveAttribute('data-status', /ok|warning/);
  await expect(opRows(page).last()).toHaveAttribute('data-status', 'ok');

  await openPanel(page, 'programs');
  await expect(page.getByTestId('program-generated')).toHaveCount(2);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-gcode').click();
  if (await page.getByTestId('export-dialog').isVisible()) await page.getByTestId('export-confirm').click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.(zip|nc)$/);
});

test('an uploaded font survives saving and opening in a fresh browser', async ({ page, browser }) => {
  await setStock(page, 200, 100, 18);
  await addText(page);
  await setContent(page, 'VOHA'); // the test font only has H, O, A and V
  await page.getByTestId('text-font-file').setInputFiles(path.join(FIXTURES, 'TestSans.otf'));
  await expect(page.getByTestId('text-font').locator('option:checked')).toHaveText('TestSans.otf');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('save').click();
  const saved = await (await downloadPromise).path();
  if (!saved) throw new Error('download has no local path');
  const bytes = await fs.readFile(saved);
  await page.reload();

  const context = await browser.newContext(); // no IndexedDB: the font can only come from the .spon file
  try {
    const fresh = await context.newPage();
    await fresh.addInitScript(NO_PICKERS);
    await fresh.goto('/');
    await fresh.getByTestId('open-input').setInputFiles({ name: 'sign.spon', mimeType: 'application/octet-stream', buffer: bytes });
    await openPanel(fresh, 'text');
    await expect(textRows(fresh)).toHaveCount(1);
    await textRows(fresh).first().click();
    const select = fresh.getByTestId('text-font');
    await expect(select.locator('optgroup[label="In this job"] option')).toHaveText(['TestSans.otf']);
    await expect(select.locator('option:checked')).toHaveText('TestSans.otf');
    await expect(textRows(fresh).first()).toHaveAttribute('data-status', 'ok');
    await expect(fresh.getByTestId('text-problem')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('single-line text on a model face: centre on the boss top and engrave', async ({ page }) => {
  await openFixture(page, 'stepped.stl');
  await page.getByTestId('units-mm').click();
  await expect(page.getByTestId('model-size')).toBeVisible();
  await addText(page);
  await page.getByTestId('text-font').selectOption('bundled:hersheySans');
  await page.getByTestId('text-surface').selectOption('face');
  await page.getByTestId('view-top').click();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('text-pick-face')).toHaveText('Pick face'); // choosing Face starts the pick
  const box = await canvasBox(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.move(x + 1, y); // second move so R3F registers hover
  await page.mouse.click(x + 1, y); // the boss top is at the centre of a top view
  await expect(page.getByTestId('text-centre-face')).toBeVisible();
  await page.getByTestId('text-centre-face').click();
  await addOpFromRow(page, 'engrave');
  await pickTool(page, 'starter-vbit-60');
  await expect(opRows(page).last()).toHaveAttribute('data-status', /ok|warning/);
  await openPanel(page, 'programs');
  await expect(page.getByTestId('program-generated')).toHaveCount(1);
});

test('a single-line font is refused by a pocket', async ({ page }) => {
  await setStock(page, 200, 100, 18);
  await addText(page);
  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-pocket').click();
  await expect(page.getByTestId('inspector')).toBeVisible();
  await page.getByTestId('inspector-tab-geometry').click();
  // the geometry tab offers a Pocket no single-line text, so the refusal shows when a ticked text changes to a single-line font
  await page.locator('[data-testid^="catalog-text-"]').first().locator('input').check();
  await openPanel(page, 'text');
  await textRows(page).first().click();
  await page.getByTestId('text-font').selectOption('bundled:hersheySans');
  await openPanel(page, 'operations');
  await expect(opRows(page).last()).toHaveAttribute('data-status', 'error');
  await expect(opRows(page).last().getByTestId('op-problem')).toHaveText('Text 1 uses a single-line font; this operation needs closed outlines');
});
