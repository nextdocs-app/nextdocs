import { shareDocument } from '../support/api';
import {
  createThread,
  openCommentsSidebar,
  replyToFirstThread,
  resolveFirstThread,
} from '../support/comments';
import { MEMBER } from '../support/config';
import { expect, test } from '../support/fixtures';
import { openDocument, openSignedIn } from '../support/session';

test.describe('comments', () => {
  test('anchors a thread on the selection and shows it to a second client', async ({
    browser,
    auth,
    docId,
  }) => {
    await shareDocument(auth.accessToken, docId, MEMBER.email, 'COMMENT');

    const owner = await openSignedIn(browser);
    const member = await openSignedIn(browser, MEMBER);
    try {
      const ownerEditor = await openDocument(owner.page, docId);
      await ownerEditor.click();
      await owner.page.keyboard.type('Comment target text');
      await createThread(owner.page, 'Please review this paragraph');

      await openDocument(member.page, docId, { editable: false });
      await openCommentsSidebar(member.page);

      await expect(member.page.getByText('Please review this paragraph')).toBeVisible();
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });

  test('a COMMENT collaborator can reply and the owner sees it', async ({
    browser,
    auth,
    docId,
  }) => {
    await shareDocument(auth.accessToken, docId, MEMBER.email, 'COMMENT');

    const owner = await openSignedIn(browser);
    const member = await openSignedIn(browser, MEMBER);
    try {
      const ownerEditor = await openDocument(owner.page, docId);
      await ownerEditor.click();
      await owner.page.keyboard.type('Discussion target');
      await createThread(owner.page, 'Owner question');

      await openDocument(member.page, docId, { editable: false });
      await openCommentsSidebar(member.page);
      await replyToFirstThread(member.page, 'Reply from the reviewer');

      await openCommentsSidebar(owner.page);
      await expect(owner.page.getByText('Reply from the reviewer')).toBeVisible();
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });

  test('resolving a thread removes it from the open list for the other client', async ({
    browser,
    auth,
    docId,
  }) => {
    await shareDocument(auth.accessToken, docId, MEMBER.email, 'COMMENT');

    const owner = await openSignedIn(browser);
    const member = await openSignedIn(browser, MEMBER);
    try {
      const ownerEditor = await openDocument(owner.page, docId);
      await ownerEditor.click();
      await owner.page.keyboard.type('Resolve target');
      await createThread(owner.page, 'Resolve this');
      await openCommentsSidebar(owner.page);

      await openDocument(member.page, docId, { editable: false });
      await openCommentsSidebar(member.page);
      await expect(member.page.getByText('Resolve this')).toBeVisible();

      await resolveFirstThread(owner.page);

      await expect(member.page.locator('.bn-thread')).toHaveCount(0);
      await member.page.getByRole('tab', { name: /Resolved/ }).click();
      await expect(member.page.getByText('Resolve this')).toBeVisible();
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });
});
