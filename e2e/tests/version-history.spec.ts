import { shareDocument } from '../support/api';
import { createThread, openCommentsSidebar } from '../support/comments';
import { MEMBER } from '../support/config';
import { expect, test } from '../support/fixtures';
import { editor, openDocument, openSignedIn } from '../support/session';
import {
  closeVersionHistory,
  nameCurrentVersion,
  openVersionHistory,
  previewEditor,
  previewVersion,
  restoreVersion,
  versionHistoryRow,
} from '../support/version-history';

const FIRST_REVISION = 'First revision survives the restore';
const SECOND_REVISION = 'Second revision should be rolled back';

test.describe('version history', () => {
  test('previews and restores an earlier version', async ({ browser, docId }) => {
    const { context, page } = await openSignedIn(browser);
    try {
      const editable = await openDocument(page, docId);
      await editable.click();
      await page.keyboard.type(FIRST_REVISION);
      await expect(editable).toContainText(FIRST_REVISION);

      // A named point closes the current activity group, giving the test two
      // deterministic rows without waiting for Yhub's hour-wide idle gap.
      await openVersionHistory(page);
      await expect(page.getByRole('button', { name: 'Restore version' })).toBeDisabled();
      await nameCurrentVersion(page, 'First revision');
      await closeVersionHistory(page);

      await editor(page).click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(SECOND_REVISION);
      await expect(editor(page)).toContainText(SECOND_REVISION);
      await expect(editor(page)).not.toContainText(FIRST_REVISION);

      await openVersionHistory(page);
      await previewVersion(page, 'First revision');
      await expect(previewEditor(page)).toContainText(FIRST_REVISION);
      await expect(previewEditor(page)).not.toContainText(SECOND_REVISION);

      await restoreVersion(page, 'First revision');
      await expect(editor(page)).toContainText(FIRST_REVISION);
      await expect(editor(page)).not.toContainText(SECOND_REVISION);

      // Rollback wrote the live room, not just a local preview.
      await page.reload();
      await expect(await openDocument(page, docId)).toContainText(FIRST_REVISION);
    } finally {
      await context.close();
    }
  });

  test('reconstructs comment anchors from the restored version', async ({ browser, docId }) => {
    const { context, page } = await openSignedIn(browser);
    try {
      const editable = await openDocument(page, docId);
      await editable.click();
      await page.keyboard.type('A paragraph with a discussion');
      await expect(editable).toContainText('A paragraph with a discussion');

      await createThread(page, 'This discussion must survive the restore');

      await openVersionHistory(page);
      await nameCurrentVersion(page, 'With discussion');
      await closeVersionHistory(page);

      // Remove the anchored content. The thread stays in the API, but its mark
      // leaves the Y.Doc; only a historical snapshot still carries the anchor.
      const liveEditor = editor(page);
      await liveEditor.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.type('Rewritten content without the discussion');
      await expect(liveEditor).toContainText('Rewritten content without the discussion');
      await expect(page.locator('.bn-thread-mark')).toHaveCount(0);

      await openVersionHistory(page);
      await previewVersion(page, 'With discussion');
      await expect(previewEditor(page).locator('.bn-thread-mark')).toBeVisible();

      await restoreVersion(page, 'With discussion');
      await expect(editor(page).locator('.bn-thread-mark')).toBeVisible();

      // Live threads were never versioned, so the restored anchor points at the
      // same thread the API kept, and the discussion is readable again.
      await openCommentsSidebar(page);
      await expect(page.getByText('This discussion must survive the restore')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('takes over the mobile viewport below the toolbar', async ({ browser, docId }) => {
    const { context, page } = await openSignedIn(browser);
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      const editable = await openDocument(page, docId);
      await editable.click();
      await page.keyboard.type('Mobile history layout');
      await expect(editable).toContainText('Mobile history layout');

      await openVersionHistory(page);
      const rail = page.locator('.nd-version-history-rail');
      await expect(rail).toBeVisible();
      const box = await rail.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(380);
      expect(box?.y ?? 0).toBeGreaterThanOrEqual(40);

      // Close and Restore live in the toolbar row, which the rail must not cover.
      await expect(page.getByRole('button', { name: 'Restore version' })).toBeVisible();
      await closeVersionHistory(page);
    } finally {
      await context.close();
    }
  });

  test('a viewer can browse history without restore controls', async ({ browser, auth, docId }) => {
    const owner = await openSignedIn(browser);
    const member = await openSignedIn(browser, MEMBER);
    try {
      const ownerEditor = await openDocument(owner.page, docId);
      await ownerEditor.click();
      await owner.page.keyboard.type('History is visible to viewers');
      await expect(ownerEditor).toContainText('History is visible to viewers');

      await openVersionHistory(owner.page);
      await nameCurrentVersion(owner.page, 'Viewer history');
      await shareDocument(auth.accessToken, docId, MEMBER.email, 'VIEW');

      await openDocument(member.page, docId, { editable: false });
      await openVersionHistory(member.page);
      await previewVersion(member.page, 'Viewer history');
      await expect(previewEditor(member.page)).toContainText('History is visible to viewers');

      const row = versionHistoryRow(member.page, 'Viewer history');
      await row.locator('.bn-snapshot-menu-trigger').click();
      await expect(member.page.getByRole('menuitem', { name: 'Restore' })).toHaveCount(0);
      await expect(member.page.getByRole('button', { name: 'Restore version' })).toHaveCount(0);
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });
});
