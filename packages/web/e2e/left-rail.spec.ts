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

test('opening a model shows Model', async ({ page }) => {
  await page.getByTestId('rail-post').click();
  await openMesh(page);
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'model');
});

test('undoing an operation removal brings Operations forward, from another panel and from a hidden one', async ({ page }) => {
  await openMesh(page);
  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-drill').click();
  await page.getByTestId('op-row-0').click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('op-name')).toHaveCount(0);
  await openPanel(page, 'stock');
  await page.locator('body').press('Control+z');
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'operations');
  await expect(page.getByTestId('op-name')).toHaveCount(1);
  // the same with the panel hidden: redo the removal, hide the panel, undo again
  await page.locator('body').press('Control+Shift+z');
  await page.getByTestId('rail-operations').click();
  await expect(page.getByTestId('left-panel')).toHaveCount(0);
  await page.locator('body').press('Control+z');
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'operations');
});

test('the hidden state survives a reload; any icon brings the panel back', async ({ page }) => {
  await page.getByTestId('rail-model').click();
  await expect(page.getByTestId('left-panel')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('rail-model')).toBeVisible();
  await expect(page.getByTestId('left-panel')).toHaveCount(0);
  await page.getByTestId('rail-stock').click();
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'stock');
});

test('rail arrow keys move focus, but Alt+Arrow does not', async ({ page }) => {
  await page.getByTestId('rail-model').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('rail-orientation')).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByTestId('rail-orientation')).toBeFocused();
});

test('a summary part click focuses the matching rail icon', async ({ page }) => {
  await openMesh(page);
  await openPanel(page, 'operations');
  await page.getByTestId('setup-summary-stock').click();
  await expect(page.getByTestId('rail-stock')).toBeFocused();
});

test('operation ⋯ menu and Alt+Arrow shortcuts move and delete rows; focus follows a delete', async ({ page }) => {
  await openMesh(page);
  await openPanel(page, 'operations');
  for (const t of ['drill', 'pocket', 'profile']) {
    await page.getByTestId('add-op').click();
    await page.getByTestId(`add-op-${t}`).click();
  }
  const names = () => page.getByTestId('op-name').allTextContents();
  const start = await names();
  const menu = async (row: number, item: string) => {
    await page.getByTestId(`op-row-${row}`).getByTestId('op-menu').click();
    await page.getByTestId(item).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  };
  await menu(1, 'op-up');
  await expect.poll(names).toEqual([start[1], start[0], start[2]]);
  await menu(0, 'op-down');
  await expect.poll(names).toEqual(start);
  await page.getByTestId('op-row-0').getByTestId('op-menu').click();
  await expect(page.getByTestId('op-up')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByTestId('op-row-2').getByTestId('op-menu').click();
  await expect(page.getByTestId('op-down')).toBeDisabled();
  await page.keyboard.press('Escape');
  // wait until the menu has closed and handed focus back to its ⋯ button, so the focus below sticks
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByTestId('op-row-2').getByTestId('op-menu')).toBeFocused();
  // a row is keyboard-selectable; Alt+ArrowDown / Alt+ArrowUp move it
  await page.getByTestId('op-row-0').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('op-row-0')).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(names).toEqual([start[1], start[0], start[2]]);
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(names).toEqual(start);
  // Delete from the menu: focus goes to the next row's menu, and to Add operation after the last row
  await menu(1, 'op-delete');
  await expect.poll(names).toEqual([start[0], start[2]]);
  await expect(page.getByTestId('op-row-1').getByTestId('op-menu')).toBeFocused();
  await menu(1, 'op-delete');
  await expect(page.getByTestId('add-op')).toBeFocused();
  await page.getByTestId('undo').click();
  await expect.poll(names).toEqual([start[0], start[2]]);
});

function program(name: string): { name: string; mimeType: string; buffer: Buffer } {
  const lines = ['G21 G90 G17 G54', 'S9000 M3', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-1 F300', 'G1 X10 Y0 F600', 'G0 Z5', 'M5', 'M30'];
  return { name, mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n')) };
}

test('imported programs: ⋯ menu and drag reorder, each one undo step; Remove', async ({ page }) => {
  for (const n of ['prog-a.nc', 'prog-b.nc', 'prog-c.nc']) {
    await page.getByTestId('open-input').setInputFiles(program(n));
    await expect(page.getByTestId(`program-${n}`)).toBeVisible();
  }
  await expect(page.getByTestId('left-panel')).toHaveAttribute('data-panel', 'programs');
  const order = () => page.locator('[data-active]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
  const start = ['program-prog-a.nc', 'program-prog-b.nc', 'program-prog-c.nc'];
  await expect.poll(order).toEqual(start);
  const menu = async (name: string, item: string) => {
    await page.getByTestId(`program-${name}`).getByTestId('program-menu').click();
    await page.getByTestId(item).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  };
  await menu('prog-a.nc', 'program-down');
  await expect.poll(order).toEqual([start[1], start[0], start[2]]);
  await page.getByTestId('undo').click();
  await expect.poll(order).toEqual(start);
  await menu('prog-c.nc', 'program-up');
  await expect.poll(order).toEqual([start[0], start[2], start[1]]);
  await page.getByTestId('undo').click();
  await expect.poll(order).toEqual(start);
  // drag the first row below the third
  await page.getByTestId('program-prog-a.nc').getByTestId('program-drag').hover();
  await page.mouse.down();
  const tb = (await page.getByTestId('program-prog-c.nc').boundingBox())!;
  await page.mouse.move(tb.x + 20, tb.y + tb.height - 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(order).toEqual([start[1], start[2], start[0]]);
  await page.getByTestId('undo').click();
  await expect.poll(order).toEqual(start);
  await menu('prog-b.nc', 'program-remove');
  await expect.poll(order).toEqual([start[0], start[2]]);
});

test('operation line 2 lines up under the name', async ({ page }) => {
  await openMesh(page);
  await openPanel(page, 'operations');
  await page.getByTestId('add-op').click();
  await page.getByTestId('add-op-drill').click();
  const name = (await page.getByTestId('op-row-0').getByTestId('op-name').boundingBox())!;
  const tool = (await page.getByTestId('op-row-0').getByTestId('op-tool').boundingBox())!;
  expect(Math.abs(name.x - tool.x)).toBeLessThan(4);
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
  await page.keyboard.press('Control+z'); // one undo step restores the order
  await expect.poll(names).toEqual(start);
  // shortcuts on the selected row; typing in the job name does not trigger them
  await page.getByTestId('op-row-0').click();
  await page.keyboard.press('Control+d');
  await expect(page.getByTestId('op-name')).toHaveCount(4);
  await page.keyboard.press('Control+Shift+d'); // Shift makes it another shortcut
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

test('Machine dialog: unit labels never overlap the numbers, and the profile name fits', async ({ page }) => {
  await page.getByTestId('machine-open').click();
  for (const id of ['machine-rapid-x', 'machine-rapid-z', 'machine-accel-x', 'machine-max-feed', 'machine-tool-change']) {
    // right edge of the typed text (right-aligned, so it ends at the input's content edge) vs the left edge of its unit label
    const gap = await page.getByTestId(id).evaluate((input: HTMLInputElement) => {
      const style = getComputedStyle(input);
      const box = input.getBoundingClientRect();
      const textRight = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
      const suffix = input.parentElement!.querySelector('span')!.getBoundingClientRect();
      return suffix.left - textRight;
    });
    expect(gap, id).toBeGreaterThanOrEqual(0);
  }
  // the selected profile name must fit beside the dropdown arrow (about 20 px)
  const room = await page.getByTestId('machine-preset').evaluate((s: HTMLSelectElement) => {
    const style = getComputedStyle(s);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const text = ctx.measureText(s.selectedOptions[0].text).width;
    return s.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20 - text;
  });
  expect(room).toBeGreaterThanOrEqual(0);
});
