import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const FIXTURES = path.resolve(import.meta.dirname, '../../core/test/fixtures');

/**
 * Shows a left-rail panel, without hiding it when it is already open. Retries when an automatic switch (a finished import
 * bringing Model forward) races the click, so it never ends on another panel or with the panel hidden.
 */
export async function openPanel(page: Page, id: string): Promise<void> {
  const host = page.getByTestId('left-panel');
  await expect(async () => {
    if (!(await host.count()) || (await host.getAttribute('data-panel')) !== id) await page.getByTestId(`rail-${id}`).click();
    await expect(host).toHaveAttribute('data-panel', id, { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}
