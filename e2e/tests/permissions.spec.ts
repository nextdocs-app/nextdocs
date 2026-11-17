import { shareDocument } from '../support/api';
import { MEMBER } from '../support/config';
import { expect, test } from '../support/fixtures';
import { openDocument, openSignedIn } from '../support/session';

test.describe('document permissions in the editor', () => {
  test('a VIEW collaborator reads the content but cannot edit', async ({
    browser,
    auth,
    docId,
  }) => {
    await shareDocument(auth.accessToken, docId, MEMBER.email, 'VIEW');

    const owner = await openSignedIn(browser);
    const member = await openSignedIn(browser, MEMBER);
    try {
      const ownerEditor = await openDocument(owner.page, docId);
      await ownerEditor.click();
      await owner.page.keyboard.type('Visible to the viewer');
      await expect(ownerEditor).toContainText('Visible to the viewer');

      const viewerEditor = await openDocument(member.page, docId, { editable: false });
      await expect(viewerEditor).toContainText('Visible to the viewer');

      await viewerEditor.click();
      await member.page.keyboard.type(' viewer edit');
      await expect(viewerEditor).not.toContainText('viewer edit');
      await expect(ownerEditor).not.toContainText('viewer edit');
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });

  test('an EDIT collaborator’s changes reach the owner', async ({ browser, auth, docId }) => {
    await shareDocument(auth.accessToken, docId, MEMBER.email, 'EDIT');

    const owner = await openSignedIn(browser);
    const member = await openSignedIn(browser, MEMBER);
    try {
      const ownerEditor = await openDocument(owner.page, docId);
      const memberEditor = await openDocument(member.page, docId);

      await memberEditor.click();
      await member.page.keyboard.type('Written by the collaborator');

      await expect(ownerEditor).toContainText('Written by the collaborator');

      await owner.page.reload();
      const reloaded = await openDocument(owner.page, docId);
      await expect(reloaded).toContainText('Written by the collaborator');
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });

  test('a user without access sees the restricted screen, not the content', async ({
    browser,
    docId,
  }) => {
    // The fixture document belongs to the owner and is never shared here.
    const member = await openSignedIn(browser, MEMBER);
    try {
      await member.page.goto(`/doc/${docId}`);
      await expect(
        member.page.getByText('Access to this document has been restricted')
      ).toBeVisible();
      await expect(member.page.locator('main .bn-editor')).toHaveCount(0);
    } finally {
      await member.context.close();
    }
  });
});
