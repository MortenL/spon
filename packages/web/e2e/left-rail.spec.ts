import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURES, openPanel } from './helpers';

const MESH = 'box-20x10x5.stl';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/');
});

async function openMesh(page: Page) {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, MESH));
  await page.getByTestId('units-mm').click();
  await expect(page.getByTestId('model-size')).toBeVisible(); // the import has finished and brought the Model panel forward
}

test('one panel at a time; clicking the open icon hides it; any icon shows it again', async ({ page }) => {
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'model');
  await page.getByTestId('rail-stock').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'stock');
  await page.getByTestId('rail-stock').click();
  await expect(page.getByTestId('left-panel')).toHaveCount(0);
  await page.getByTestId('rail-post').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'post');
});

test('the width and the open panel survive a reload', async ({ page }) => {
  await page.getByTestId('rail-programs').click();
  const handle = page.getByRole('separator', { name: 'Resize panel' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const before = (await page.getByTestId('left-panel').boundingBox())!.width;
  expect(before).toBeGreaterThan(400);
  await page.reload();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'programs');
  expect(Math.abs((await page.getByTestId('left-panel').boundingBox())!.width - before)).toBeLessThan(3);
});

test('opening a model shows Model; adding an operation shows Operations', async ({ page }) => {
  await page.getByTestId('rail-post').click();
  await openMesh(page);
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'model');
  await openPanel(page, 'operations');
  await page.getByTestId('rail-stock').click();
  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-drill').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'operations');
});

test('fixed stock that is too small: amber dot and summary', async ({ page }) => {
  await openMesh(page);
  await openPanel(page, 'stock');
  await page.getByTestId('stock-mode-fixed').click();
  await page.getByTestId('stock-size-z').fill('1');
  await page.getByTestId('stock-size-z').press('Enter');
  await expect(page.getByTestId('rail-dot-stock')).toHaveAttribute('data-state', 'attention');
  await openPanel(page, 'operations');
  await expect(page.getByTestId('setup-summary-stock')).toHaveClass(/amber/);
  await page.getByTestId('setup-summary-stock').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'stock');
});

test('reorder by drag and by keyboard; one undo step each; menu and shortcuts', async ({ page }) => {
  await openMesh(page);
  await openPanel(page, 'operations');
  for (const t of ['drill', 'pocket', 'profile']) {
    await page.getByTestId('add-op').click();
    await page.getByTestId(`add-op-${t}`).click();
  }
  const names = () => page.getByTestId('op-name').allTextContents();
  const start = await names();
  // drag the first row below the third
  const from = page.getByTestId('op-row-0').getByTestId('op-drag');
  const to = page.getByTestId('op-row-2');
  await from.hover();
  await page.mouse.down();
  const tb = (await to.boundingBox())!;
  await page.mouse.move(tb.x + 20, tb.y + tb.height - 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(names).toEqual([start[1], start[2], start[0]]);
  await page.getByTestId('undo').click();
  await expect.poll(names).toEqual(start);
  // keyboard: focus a handle, Space, ArrowDown, Space
  await page.getByTestId('op-row-0').getByTestId('op-drag').focus();
  await page.keyboard.press('Space');
  await expect(page.getByText(/is over position 1$/)).toBeAttached(); // dnd-kit has started listening for the arrow keys
  await page.keyboard.press('ArrowDown');
  await expect(page.getByText(/is over position 2$/)).toBeAttached();
  await page.keyboard.press('Space');
  await expect.poll(names).toEqual([start[1], start[0], start[2]]);
  // shortcuts on the selected row; typing in the job name does not trigger them
  await page.getByTestId('op-row-0').click();
  await page.keyboard.press('Control+d');
  await expect(page.getByTestId('op-name')).toHaveCount(4);
  await page.getByTestId('job-name').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('op-name')).toHaveCount(4);
  await page.getByTestId('op-row-0').click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('op-name')).toHaveCount(3);
  // the ⋯ menu
  await page.getByTestId('op-row-0').getByTestId('op-menu').click();
  await page.getByTestId('op-duplicate').click();
  await expect(page.getByTestId('op-name')).toHaveCount(4);
});

test('Machine settings open from the top bar', async ({ page }) => {
  await page.getByTestId('machine-open').click();
  await expect(page.getByTestId('machine-preset')).toBeVisible();
});
