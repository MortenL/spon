import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');

/** Shows a left-rail panel, without hiding it when it is already open. */
export async function openPanel(page: Page, id: string): Promise<void> {
  const host = page.getByTestId('left-panel');
  if ((await host.count()) && (await host.getAttribute('data-panel')) === id) return;
  await page.getByTestId(`rail-${id}`).click();
  // A restored job can switch the panel automatically between the check and the click, which turns the click into a hide. Click again then.
  if (!(await host.count()) || (await host.getAttribute('data-panel')) !== id) await page.getByTestId(`rail-${id}`).click();
  await expect(host).toHaveAttribute('data-panel', id);
}
