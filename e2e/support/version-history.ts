import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** The editor surface in history mode; it is read-only, so `editor()` won't match it. */
export function previewEditor(page: Page) {
  return page.locator('main .bn-editor').first();
}

/** The docked Yhub history panel. */
export function versionHistoryPanel(page: Page) {
  return page.getByRole('region', { name: 'Version history' });
}

export async function openVersionHistory(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'More document actions' }).click();
  await page.getByRole('menuitem', { name: 'Version history' }).click();
  await expect(versionHistoryPanel(page)).toBeVisible();
  await expect(versionHistoryPanel(page).locator('.bn-snapshot').first()).toBeVisible();
}

export async function closeVersionHistory(page: Page): Promise<void> {
  // The X replaced the actions menu in the top-right document toolbar.
  await page.getByRole('button', { name: 'Close version history' }).click();
  await expect(versionHistoryPanel(page)).toBeHidden();
}

export function versionHistoryRow(page: Page, name: string) {
  // The current row keeps its name in an <input> (it is editable in place), so
  // match the row's accessible name rather than its text content.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return versionHistoryPanel(page).getByRole('listitem', { name: new RegExp(escaped) });
}

/**
 * Names the current activity window, which also closes it. Yhub's activity
 * grouping keeps a pending group open until a named version or an idle gap, so
 * this is what makes two edits seconds apart appear as two history rows.
 */
export async function nameCurrentVersion(page: Page, name: string): Promise<void> {
  const panel = versionHistoryPanel(page);
  const currentRow = panel.locator('.bn-snapshot').first();
  await currentRow.locator('.bn-snapshot-menu-trigger').click();
  await page.getByRole('menuitem', { name: 'Name this version' }).click();

  const input = panel.getByRole('textbox', { name: 'Version name' });
  await input.fill(name);
  await input.press('Enter');

  await expect(versionHistoryRow(page, name)).toBeVisible();
}

export async function previewVersion(page: Page, name: string): Promise<void> {
  await versionHistoryRow(page, name).click();
}

export async function restoreVersion(page: Page, name: string): Promise<void> {
  await versionHistoryRow(page, name).click();
  const restore = page.getByRole('button', { name: 'Restore version' });
  await expect(restore).toBeEnabled();
  await restore.click();
  await expect(versionHistoryPanel(page)).toBeHidden();
}
