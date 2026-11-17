import { createThread, openCommentsSidebar } from '../support/comments';
import { expect, test } from '../support/fixtures';
import { openDocument, openSignedIn } from '../support/session';

test.describe('multiple tabs', () => {
  test('edits synchronize between two tabs of the same browser', async ({ browser, docId }) => {
    const session = await openSignedIn(browser);
    const secondTab = await session.context.newPage();
    try {
      const firstEditor = await openDocument(session.page, docId);
      const secondEditor = await openDocument(secondTab, docId);

      await firstEditor.click();
      await session.page.keyboard.type('Typed in the first tab');
      await expect(secondEditor).toContainText('Typed in the first tab');

      await secondEditor.click();
      await secondTab.keyboard.press('Control+End');
      await secondTab.keyboard.type(' and the second');
      await expect(firstEditor).toContainText('and the second');
    } finally {
      await session.context.close();
    }
  });

  test('a comment created in one tab appears in the other tab’s open sidebar', async ({
    browser,
    docId,
  }) => {
    const session = await openSignedIn(browser);
    const secondTab = await session.context.newPage();
    try {
      const firstEditor = await openDocument(session.page, docId);
      await openDocument(secondTab, docId);

      await secondTab.bringToFront();
      await openCommentsSidebar(secondTab);

      // A background tab does not own the selection, so the composer's toolbar
      // only appears once this tab is active.
      await session.page.bringToFront();
      await firstEditor.click();
      await session.page.keyboard.type('Cross-tab target');
      await createThread(session.page, 'Cross-tab comment');

      // Comments live in Postgres and notify other clients through awareness.
      await expect(secondTab.getByText('Cross-tab comment')).toBeVisible();
    } finally {
      await session.context.close();
    }
  });
});
