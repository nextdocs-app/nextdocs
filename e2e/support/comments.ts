import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { editor } from './session';

/** Selects the whole block, opens the composer and submits the first comment. */
export async function createThread(page: Page, body: string): Promise<void> {
  const editable = editor(page);
  await editable.click();
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Add comment' }).click();

  const composer = page.locator('.bn-comment-editor [contenteditable="true"]').first();
  await composer.click();
  await page.keyboard.type(body);
  await page.getByRole('button', { name: 'Comment', exact: true }).click();

  // The mark is applied by the realtime service, not by the composer.
  await expect(page.locator('.bn-thread-mark').first()).toBeVisible();
}

export async function openCommentsSidebar(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Open comments sidebar/ }).click();
}

/** Expands the first thread and submits a reply. */
export async function replyToFirstThread(page: Page, body: string): Promise<void> {
  const thread = page.locator('.bn-thread').first();
  await thread.click();
  const reply = page.locator('.bn-thread-composer [contenteditable="true"]').first();
  await reply.click();
  await page.keyboard.type(body);
  await page.locator('.bn-thread-composer').getByRole('button', { name: 'Comment' }).click();
}

/**
 * Resolves the first thread. BlockNote renders three icon buttons per comment
 * (reaction, resolve, more actions) without accessible names, so resolve is
 * addressed by its position in that toolbar.
 */
export async function resolveFirstThread(page: Page): Promise<void> {
  const comment = page.locator('.bn-thread-comment').first();
  await comment.hover();
  await comment.locator('button').nth(1).click();
  // The Open filter is active, so a resolved thread leaves the list.
  await expect(page.locator('.bn-thread')).toHaveCount(0);
}
