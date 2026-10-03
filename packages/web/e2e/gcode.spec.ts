import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { FIXTURES, openPanel } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
});

async function openFixture(page: Page, name: string) {
  await page.getByTestId('open-input').setInputFiles(path.join(FIXTURES, name));
}

test('G-code: load over a job, analyse, jump to the diagnostic, scrub, and restore after reload', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'box-20x10x5.stl');
  await page.getByTestId('units-mm').click();
  await expect(page.getByTestId('model-size')).toHaveText('20.00 × 10.00 × 5.00 mm');

  await openFixture(page, 'drill-arc.nc');
  const row = page.getByTestId('program-drill-arc.nc');
  await expect(row).toBeVisible();
  await expect(row.getByTestId('program-time')).toHaveText(/^\d+:\d{2}$/);

  // analysis: exactly one error, the deliberate rapid into the stock on line 18 (0-based 17)
  await page.getByTestId('dock-tab-analysis').click();
  const diagnostics = page.getByTestId('diagnostic');
  await expect(diagnostics).toHaveCount(1);
  await expect(diagnostics.first()).toHaveAttribute('data-code', 'rapid-into-stock');
  const total = await page.getByTestId('analysis-total-time').textContent();
  expect(total).toMatch(/^\d+:\d{2}$/);
  expect(total).not.toBe('0:00');
  await expect(row.getByTestId('program-time')).toHaveText(total!);

  // clicking the diagnostic shows and selects its line
  await diagnostics.first().click();
  await expect(page.locator('[data-testid="gcode-line"][data-selected="true"]')).toHaveAttribute('data-line', '17');

  // scrubbing to 90% moves the current line past the 30 s tool change (line 4 = index 3)
  await page.getByTestId('timeline-scrubber').fill('900');
  const current = page.locator('[data-testid="gcode-line"][data-current="true"]');
  await expect(current).toHaveCount(1);
  expect(Number(await current.getAttribute('data-line'))).toBeGreaterThan(3);

  // autosave restores the program and its analysis
  await page.waitForTimeout(1500);
  await page.reload();
  await openPanel(page, 'programs'); // the remembered panel; the restore no longer switches panels
  await expect(page.getByTestId('program-drill-arc.nc')).toBeVisible();
  await page.getByTestId('dock-tab-analysis').click();
  await expect(page.getByTestId('diagnostic')).toHaveCount(1);
});

test('G-code without a model: rapids below Z 0 are reported and the machine profile changes the time', async ({ page }) => {
  await page.goto('/');
  await openFixture(page, 'drill-arc.nc');
  const time = page.getByTestId('program-drill-arc.nc').getByTestId('program-time');
  await expect(time).toHaveText(/^\d+:\d{2}$/);
  const before = await time.textContent();

  // no stock: the deliberate rapid is reported as "below Z 0"
  await page.getByTestId('dock-tab-analysis').click();
  await expect(page.getByTestId('diagnostic')).toHaveCount(1);

  await page.getByTestId('machine-open').click();
  await page.getByTestId('machine-preset').selectOption('Generic VMC');
  await expect(time).not.toHaveText(before!); // 5 s tool change instead of 30 s
});

// No M6 tool change (its fixed cost would dwarf everything else here): just modal setup plus many
// small moves, so playback time is driven by the moves themselves and stays easy to reason about.
function smallMoves(name: string, count: number): { name: string; mimeType: string; buffer: Buffer } {
  const lines = ['G21 G90 G17 G54', 'S9000 M3', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-1 F300'];
  for (let i = 1; i <= count; i++) lines.push(`G1 X${(i * 0.5).toFixed(1)} Y0 F3000`);
  lines.push('G0 Z5', 'M5', 'M30');
  return { name, mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n')) };
}

test('G-code list follows the current line during and after playback, even after a diagnostic (or any line) was selected', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-input').setInputFiles(smallMoves('follow-test.nc', 150));
  await expect(page.getByTestId('program-follow-test.nc')).toBeVisible();
  await page.getByTestId('dock-tab-gcode').click();

  // select a line near the top, as clicking a diagnostic would (both call seekToLine)
  await page.locator('[data-testid="gcode-line"][data-line="5"]').click();
  await expect(page.locator('[data-testid="gcode-line"][data-selected="true"]')).toHaveAttribute('data-line', '5');
  await expect(page.locator('[data-testid="gcode-line"][data-current="true"]')).toHaveCount(1); // paused: still visible near the selection

  // play forward well past the selected line and the ~25-row rendered window around it, while
  // staying comfortably short of the ~11 s total (so it's still playing, not paused-at-the-end)
  await page.getByTestId('speed').selectOption('5');
  await page.getByTestId('play').click();
  await page.waitForTimeout(600);

  // the previously selected line (5) must not still be pinning the view: the current line should
  // have advanced well past it and still be rendered (i.e. the list scrolled to follow it)
  const current = page.locator('[data-testid="gcode-line"][data-current="true"]');
  await expect(current).toHaveCount(1);
  const whilePlaying = Number(await current.getAttribute('data-line'));
  expect(whilePlaying).toBeGreaterThan(24);

  // pausing must keep following the current line too, not revert to the stale line-5 selection
  await page.getByTestId('play').click();
  await expect(current).toHaveCount(1);
  expect(Number(await current.getAttribute('data-line'))).toBeGreaterThanOrEqual(whilePlaying);

  // scrubbing back near the top also keeps the (now different) current line rendered in the viewport
  await page.getByTestId('timeline-scrubber').fill('50');
  await expect(current).toHaveCount(1);
});

test('playback keys still work after dragging the scrubber or picking a speed', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-input').setInputFiles(smallMoves('keys-test.nc', 150));
  await expect(page.getByTestId('program-keys-test.nc')).toBeVisible();

  const move = page.getByTestId('timeline-move');
  const currentLine = async () => {
    const text = (await move.textContent()) ?? '';
    const m = /line (\d+)/.exec(text);
    if (!m) throw new Error(`no "line N" in "${text}"`);
    return Number(m[1]);
  };

  // dragging/clicking the scrubber must not stop the arrow keys from working as playback keys
  await page.getByTestId('timeline-scrubber').fill('300');
  await page.keyboard.press('ArrowRight');
  const afterFirst = await currentLine();
  await page.keyboard.press('ArrowRight');
  const afterSecond = await currentLine();
  expect(afterSecond).toBe(afterFirst + 1); // exactly one move advanced, not stuck (also covers I1)

  // same for the speed <select>
  await page.getByTestId('speed').selectOption('2');
  await page.keyboard.press('ArrowRight');
  const afterThird = await currentLine();
  expect(afterThird).toBe(afterSecond + 1);

  // a real text input must still block the playback keys
  await page.getByTestId('machine-open').click();
  await page.getByTestId('machine-tool-change').click();
  await page.keyboard.press('ArrowRight');
  await expect(move).toHaveText(new RegExp(`line ${afterThird}\\b`)); // unchanged: the keypress was blocked
});

test('the active program (and its G-code list) follows the playhead across a program boundary when scrubbing', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-input').setInputFiles(smallMoves('prog-a.nc', 20));
  await expect(page.getByTestId('program-prog-a.nc')).toBeVisible();
  await page.getByTestId('open-input').setInputFiles(smallMoves('prog-b.nc', 20));
  await expect(page.getByTestId('program-prog-b.nc')).toBeVisible();

  // prog-b is active (most recently loaded); scrub to the middle of the combined timeline,
  // which falls inside prog-a's segment (prog-a plays first, in list order)
  await page.getByTestId('timeline-scrubber').fill('250');
  await expect(page.getByTestId('program-prog-a.nc')).toHaveAttribute('data-active', 'true');
  await page.getByTestId('dock-tab-gcode').click();
  await expect(page.locator('[data-testid="gcode-line"][data-current="true"]')).toHaveCount(1);
});
